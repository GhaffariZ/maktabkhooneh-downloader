import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FakeUpstreamServer } from './fake-upstream.js';
import { DownloadEngine } from '../../../server/downloader/download-engine.js';
import { StorageManager } from '../../../server/storage/storage-manager.js';
import { MaktabkhoonehClient } from '../../../server/platform/client.js';
import { Download } from '../../../shared/types.js';

describe('Download Engine Resilience & Edge Cases', () => {
  let fakeUpstream: FakeUpstreamServer;
  let tmpDataDir: string;
  let tmpDownloadDir: string;
  let storage: StorageManager;
  let client: MaktabkhoonehClient;

  before(async () => {
    fakeUpstream = new FakeUpstreamServer();
    const info = await fakeUpstream.start();

    tmpDataDir = path.join(os.tmpdir(), `mk-resilience-data-${Date.now()}`);
    tmpDownloadDir = path.join(os.tmpdir(), `mk-resilience-dl-${Date.now()}`);
    await fs.promises.mkdir(tmpDataDir, { recursive: true });
    await fs.promises.mkdir(tmpDownloadDir, { recursive: true });

    storage = new StorageManager(tmpDataDir);
    await storage.init();
    await storage.updateSettings({ downloadDirectory: tmpDownloadDir });

    client = new MaktabkhoonehClient({ origin: info.url });
  });

  after(async () => {
    await fakeUpstream.stop();
    try {
      await fs.promises.rm(tmpDataDir, { recursive: true, force: true });
      await fs.promises.rm(tmpDownloadDir, { recursive: true, force: true });
    } catch {}
  });

  test('handles Range ignored by server (restarts from 0 without corrupting)', async () => {
    // Tell upstream to ignore range headers and always send 200
    fakeUpstream.options.ignoreRange = true;

    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `${fakeUpstream.getUrl()}/media/video-720.mp4`,
    });

    const job = await engine.enqueue('c-resilience', 'unit-ignore-range', '720p', 'دوره تاب‌آوری', 'درس بررسی محدوده');

    // Create a partial .part file with garbage data to simulate existing interrupted download
    const courseFolder = path.join(tmpDownloadDir, 'دوره تاب‌آوری');
    await fs.promises.mkdir(courseFolder, { recursive: true });
    const partPath = path.join(courseFolder, 'درس بررسی محدوده.mp4.part');
    await fs.promises.writeFile(partPath, Buffer.alloc(100, 0x99));

    // Wait for completion
    let completed: Download | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const current = storage.getDownload(job.id);
      if (current && current.status === 'completed') {
        completed = current;
        break;
      }
    }

    assert.ok(completed, 'Job should complete even when server ignores range');
    assert.equal(completed.status, 'completed');
    assert.equal(completed.downloadedBytes, 262144);
    assert.ok(completed.filePath && fs.existsSync(completed.filePath));
    // Verify file size matches expected total exactly
    assert.equal(fs.statSync(completed.filePath!).size, 262144);

    fakeUpstream.options.ignoreRange = false;
  });

  test('pausing and canceling downloads updates status and halts network cleanly', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return `${fakeUpstream.getUrl()}/media/video-720.mp4`;
      },
    });

    const job = await engine.enqueue('c-pause', 'unit-pause', '720p', 'دوره تست توقف', 'درس توقف');
    assert.equal(job.status, 'queued');

    const paused = await engine.pause(job.id);
    assert.equal(paused.status, 'paused');

    const resumed = await engine.resume(job.id);
    assert.equal(resumed.status, 'queued');

    const canceled = await engine.cancel(job.id);
    assert.equal(canceled.status, 'canceled');
  });

  test('prevents path traversal outside of managed download folder', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `${fakeUpstream.getUrl()}/media/video-720.mp4`,
    });

    // Malicious title is sanitized so it cannot escape base download directory
    const job = await engine.enqueue(
      'c-traversal',
      'unit-malicious',
      '720p',
      '../../../../../../Windows/System32',
      'malicious'
    );
    assert.ok(job.filePath);
    const resolvedPath = path.resolve(job.filePath);
    const resolvedBase = path.resolve(tmpDownloadDir);
    assert.ok(resolvedPath.startsWith(resolvedBase), `Path ${resolvedPath} must start with ${resolvedBase}`);
    const rel = path.relative(resolvedBase, resolvedPath);
    assert.equal(rel.startsWith('..'), false);
    assert.equal(path.isAbsolute(rel), false);
  });
});
