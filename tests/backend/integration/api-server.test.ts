import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { FakeUpstreamServer } from './fake-upstream.js';
import { AppServer } from '../../../server/server.js';
import { Download } from '../../../shared/types.js';

describe('AppServer & API Contract Integration Tests', () => {
  let fakeUpstream: FakeUpstreamServer;
  let appServer: AppServer;
  let appUrl: string;
  let tmpDataDir: string;
  let tmpDownloadDir: string;

  before(async () => {
    // 1. Start Fake Upstream Server
    fakeUpstream = new FakeUpstreamServer();
    const upstreamInfo = await fakeUpstream.start();

    // 2. Temp directories
    tmpDataDir = path.join(os.tmpdir(), `mk-test-data-${Date.now()}`);
    tmpDownloadDir = path.join(os.tmpdir(), `mk-test-downloads-${Date.now()}`);
    await fs.promises.mkdir(tmpDataDir, { recursive: true });
    await fs.promises.mkdir(tmpDownloadDir, { recursive: true });

    // 3. Start AppServer targeting fake upstream with port 0
    appServer = new AppServer({
      port: 0,
      dataDir: tmpDataDir,
      platformOrigin: upstreamInfo.url,
      allowLocalTest: true,
      isDev: true,
    });

    const info = await appServer.start();
    appUrl = `http://${info.host}:${info.port}`;

    await appServer.getStorage().updateSettings({ downloadDirectory: tmpDownloadDir });
  });

  after(async () => {
    await appServer.stop();
    await fakeUpstream.stop();
    try {
      await fs.promises.rm(tmpDataDir, { recursive: true, force: true });
      await fs.promises.rm(tmpDownloadDir, { recursive: true, force: true });
    } catch {}
  });

  test('Security: responses include X-Content-Type-Options nosniff', async () => {
    const res = await fetch(`${appUrl}/api/session`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('Security: strictly rejects non-loopback Host header (403)', async () => {
    const parsed = new URL(appUrl);
    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: '/api/session',
          method: 'GET',
          headers: { Host: 'evil-attacker.com' },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(statusCode, 403);
    const json = JSON.parse(body);
    assert.equal(json.error?.code, 'INVALID_HOST');
  });

  test('Security: rejects cross-site mutation requests', async () => {
    const res = await fetch(`${appUrl}/api/session/logout`, {
      method: 'POST',
      headers: {
        'Origin': 'http://malicious-website.com',
        'Content-Type': 'application/json',
      },
    });
    assert.equal(res.status, 403);
  });

  test('Security: parseJsonBody enforces application/json content-type (415)', async () => {
    const res = await fetch(`${appUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'email=user@example.com',
    });
    assert.equal(res.status, 415);
  });

  test('Security: parseJsonBody rejects malformed JSON (400)', async () => {
    const res = await fetch(`${appUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not-valid-json }',
    });
    assert.equal(res.status, 400);
  });

  test('Security: parseJsonBody rejects JSON arrays (400)', async () => {
    const res = await fetch(`${appUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[{"email":"user@example.com"}]',
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error?.code, 'INVALID_JSON');
  });

  test('GET /api/bootstrap returns csrf token', async () => {
    const res = await fetch(`${appUrl}/api/bootstrap`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(typeof json.csrfToken === 'string');
    assert.ok(json.csrfToken.length > 10);
  });

  test('GET /api/session returns initial real unauthenticated state', async () => {
    const res = await fetch(`${appUrl}/api/session`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.authenticated, false);
    assert.equal(json.demo, false); // Demo is explicit, false in real mode
  });

  test('Real mode rejects demo fixtures by ID (404)', async () => {
    const res = await fetch(`${appUrl}/api/courses/demo-python`);
    assert.equal(res.status, 404);
  });

  test('POST /api/session/login handles failure and success with profile verification', async () => {
    // 1. Wrong password
    const failRes = await fetch(`${appUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'WrongPassword' }),
    });
    assert.equal(failRes.status, 401);

    // 2. Successful login
    const okRes = await fetch(`${appUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'ValidPassword123' }),
    });
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.authenticated, true);
    assert.equal(okJson.email, 'user@example.com');
  });

  test('POST /api/courses/refresh uses evidenced my_courses endpoint and verified fields', async () => {
    const res = await fetch(`${appUrl}/api/courses/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.courses));
    assert.ok(json.courses.length >= 1);
    const c = json.courses[0];
    assert.equal(c.id, '9876'); // Preserved card id
    assert.equal(c.slug, 'python-programming-mk10645'); // Canonical slug with -mk10645
    assert.equal(c.title, 'آموزش پایتون حرفه‌ای');
    assert.equal(c.thumbnail, 'https://maktabkhooneh.org/media/courses/python.jpg');
    assert.equal(c.instructor, 'دکتر علیرضا رضایی');
  });

  test('GET /api/courses/:id fetches outline on demand when chapters are empty', async () => {
    // Calling GET /api/courses/9876 should fetch and normalize outline using numeric ID derived from canonical slug
    const detailRes = await fetch(`${appUrl}/api/courses/9876`);
    assert.equal(detailRes.status, 200);
    const detailJson = await detailRes.json();
    assert.equal(detailJson.course.id, '9876');
    assert.ok(detailJson.chapters.length >= 1);
    assert.equal(detailJson.chapters[0].lessons[0].id, '101');
    assert.equal(detailJson.chapters[0].lessons[0].accessible, true);
  });

  test('Locked/inaccessible lessons are blocked from qualities, stream, and download (403)', async () => {
    // Lesson 103 is locked in fake upstream outline
    const qRes = await fetch(`${appUrl}/api/lessons/103/qualities?courseId=9876`);
    assert.equal(qRes.status, 403);

    const sRes = await fetch(`${appUrl}/api/lessons/103/stream?courseId=9876`);
    assert.equal(sRes.status, 403);

    const dRes = await fetch(`${appUrl}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: '9876', lessonId: '103', quality: '720p' }),
    });
    assert.equal(dRes.status, 403);
  });

  test('POST /api/downloads enqueues accessible lesson and completes', async () => {
    const res = await fetch(`${appUrl}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: '9876', lessonId: '101', quality: '720p' }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    const downloadId = json.download.id;

    // Wait for completion
    let completedJob: Download | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const listRes = await fetch(`${appUrl}/api/downloads`);
      const listJson = await listRes.json();
      const current = listJson.downloads.find((d: Download) => d.id === downloadId);
      if (current && current.status === 'completed') {
        completedJob = current;
        break;
      }
    }

    assert.ok(completedJob);
    assert.equal(completedJob.status, 'completed');

    // GET /api/courses/:id merges completed downloads into lessons for offline playback
    const courseDetailRes = await fetch(`${appUrl}/api/courses/9876`);
    assert.equal(courseDetailRes.status, 200);
    const courseDetailJson = await courseDetailRes.json();
    const lesson101 = courseDetailJson.chapters[0].lessons.find((l: any) => l.id === '101');
    assert.ok(lesson101.download);
    assert.equal(lesson101.download.status, 'completed');
  });

  test('fetchBounded enforces maximum 5 redirect hops', async () => {
    const client = appServer.getClient();
    await assert.rejects(async () => {
      await client.fetchBounded(`${fakeUpstream.getUrl()}/test-redirect-loop/`);
    }, /Exceeded maximum redirect limit of 5 hops/);
  });

  test('Settings: updates download directory with absolute path validation', async () => {
    // Relative path must be rejected with 400
    const badRes = await fetch(`${appUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadDirectory: './relative/path' }),
    });
    assert.equal(badRes.status, 400);

    // Valid absolute path succeeds
    const newTarget = path.join(tmpDownloadDir, 'updated-storage');
    const goodRes = await fetch(`${appUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadDirectory: newTarget }),
    });
    assert.equal(goodRes.status, 200);
    assert.ok(fs.existsSync(newTarget));
  });

  test('Session expiration clears session without losing cached courses', async () => {
    fakeUpstream.options.simulateExpiredSession = true;

    const refreshRes = await fetch(`${appUrl}/api/courses/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.ok(refreshJson.warning?.includes('منقضی'));
    assert.ok(refreshJson.courses.length > 0); // Preserved offline cache!

    // Session is now unauthenticated
    const sRes = await fetch(`${appUrl}/api/session`);
    const sJson = await sRes.json();
    assert.equal(sJson.authenticated, false);

    fakeUpstream.options.simulateExpiredSession = false;
  });
});
