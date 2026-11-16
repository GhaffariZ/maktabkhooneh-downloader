import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AppServer } from '../../../server/server.js';

describe('Explicit Demo Mode & Isolation', () => {
  let demoServer: AppServer;
  let demoUrl: string;
  let tmpDemoDataDir: string;
  let userFakeDownloadsDir: string;

  before(async () => {
    tmpDemoDataDir = path.join(os.tmpdir(), `mk-demo-data-${Date.now()}`);
    userFakeDownloadsDir = path.join(os.tmpdir(), `mk-user-downloads-${Date.now()}`);
    await fs.promises.mkdir(tmpDemoDataDir, { recursive: true });
    await fs.promises.mkdir(userFakeDownloadsDir, { recursive: true });

    demoServer = new AppServer({
      port: 0,
      dataDir: tmpDemoDataDir,
      isDemo: true,
      allowLocalTest: true,
      isDev: true,
    });

    const info = await demoServer.start();
    demoUrl = `http://${info.host}:${info.port}`;
  });

  after(async () => {
    await demoServer.stop();
    try {
      await fs.promises.rm(tmpDemoDataDir, { recursive: true, force: true });
      await fs.promises.rm(userFakeDownloadsDir, { recursive: true, force: true });
    } catch {}
  });

  test('GET /api/session reflects demo mode true', async () => {
    const res = await fetch(`${demoUrl}/api/session`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.authenticated, false);
    assert.equal(json.demo, true);
  });

  test('GET /api/courses returns labeled sample courses', async () => {
    const res = await fetch(`${demoUrl}/api/courses`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.courses));
    assert.ok(json.courses.length >= 2);
    assert.ok(json.courses[0].title.includes('داده نمایشی'));
  });

  test('GET /api/lessons/demo-unit-101/qualities returns honest demo qualities', async () => {
    const res = await fetch(`${demoUrl}/api/lessons/demo-unit-101/qualities?courseId=demo-python`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.qualities));
    assert.equal(json.qualities.length, 1);
    assert.equal(json.qualities[0].id, 'demo-720p');
    assert.equal(json.qualities[0].bytes, 6754);
  });

  test('Demo stream serves genuine synthetic video with 200 and 206 range support', async () => {
    // 1. Full stream request
    const fullRes = await fetch(`${demoUrl}/api/lessons/demo-unit-101/stream?courseId=demo-python`);
    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.headers.get('content-type'), 'video/mp4');
    assert.equal(fullRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(fullRes.headers.get('content-length'), '6754');
    const fullBuf = await fullRes.arrayBuffer();
    assert.equal(fullBuf.byteLength, 6754);

    // 2. Partial range request
    const rangeRes = await fetch(`${demoUrl}/api/lessons/demo-unit-101/stream?courseId=demo-python`, {
      headers: { Range: 'bytes=0-99' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-type'), 'video/mp4');
    assert.equal(rangeRes.headers.get('content-range'), 'bytes 0-99/6754');
    assert.equal(rangeRes.headers.get('content-length'), '100');
    const rangeBuf = await rangeRes.arrayBuffer();
    assert.equal(rangeBuf.byteLength, 100);
  });

  test('Demo download copies genuine synthetic video into download folder without network', async () => {
    await demoServer.getStorage().updateSettings({ downloadDirectory: userFakeDownloadsDir });

    const res = await fetch(`${demoUrl}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: 'demo-python', lessonId: 'demo-unit-101', quality: 'demo-720p' }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.ok(json.download);
    assert.equal(json.download.status, 'completed');
    assert.equal(json.download.downloadedBytes, 6754);
    assert.equal(json.download.totalBytes, 6754);

    // Verify file actually exists on disk in userFakeDownloadsDir
    assert.ok(json.download.filePath);
    assert.ok(fs.existsSync(json.download.filePath));
    const st = fs.statSync(json.download.filePath);
    assert.equal(st.size, 6754);
  });

  test('Demo login and import do not contact remote network', async () => {
    const loginRes = await fetch(`${demoUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@example.com', password: 'demo' }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.equal(loginJson.authenticated, true);
    assert.equal(loginJson.demo, true);

    const importRes = await fetch(`${demoUrl}/api/courses/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://maktabkhooneh.org/course/demo-python/' }),
    });
    assert.equal(importRes.status, 200);
    const importJson = await importRes.json();
    assert.ok(importJson.course);
  });

  test('a second launch on an occupied port leaves active download state intact', async () => {
    await demoServer.getStorage().saveDownload({
      id: 'active-demo-test',
      courseId: 'demo-python',
      lessonId: 'demo-unit-101',
      courseTitle: 'Synthetic course',
      lessonTitle: 'Synthetic lesson',
      quality: 'demo-720p',
      status: 'downloading',
      downloadedBytes: 12,
    });
    const stateFile = path.join(tmpDemoDataDir, 'demo', 'app-state.json');
    const before = await fs.promises.readFile(stateFile, 'utf8');
    const duplicate = new AppServer({
      port: demoServer.getPort(),
      dataDir: tmpDemoDataDir,
      isDemo: true,
    });
    await assert.rejects(duplicate.start(), { code: 'EADDRINUSE' });
    assert.equal(await fs.promises.readFile(stateFile, 'utf8'), before);
  });
});
