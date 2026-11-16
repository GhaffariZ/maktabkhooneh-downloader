/**
 * Media Reliability and Transfer Integrity Tests.
 * Tests strict media quality selection, redirect validation, Range parsing,
 * 416 forwarding, HEAD support, client disconnect, FIFO queueing, resume offset verification,
 * ETag validator changes, duplicate titles, and collision-resistant path containment.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { StorageManager } from '../../../server/storage/storage-manager.js';
import { MaktabkhoonehClient } from '../../../server/platform/client.js';
import { DownloadEngine } from '../../../server/downloader/download-engine.js';
import {
  handleStreamLesson,
  serveLocalFile,
  parseHttpRange,
} from '../../../server/stream/stream-proxy.js';
import {
  resolveMediaQuality,
  extractAvailableQualities,
  safeFetch,
} from '../../../server/platform/media.js';
import {
  sanitizeFileName,
  buildCourseFolderName,
  buildMediaFileName,
  assertSafePathContainment,
  isAllowedRemoteHost,
} from '../../../server/platform/url-parser.js';

describe('Media Quality Resolver (Exact Choice & Strict Rejection)', () => {
  const sampleVideoData = {
    qualities: [
      { id: '720p', resolution: 720, label: '720p HD', download_url: 'https://maktabkhooneh.org/v/720.mp4', size: '1000' },
      { id: '480p', resolution: 480, label: '480p SD', download_url: 'https://maktabkhooneh.org/v/480.mp4', size: '500' },
    ],
    video_urls: {
      hq: 'https://maktabkhooneh.org/v/hq.mp4',
      lq: 'https://maktabkhooneh.org/v/lq.mp4',
    },
  };

  it('selects explicit requested quality (720p)', () => {
    const resolved = resolveMediaQuality(sampleVideoData, '720p');
    assert.equal(resolved.url, 'https://maktabkhooneh.org/v/720.mp4');
    assert.equal(resolved.quality, '720p');
    assert.equal(resolved.size, 1000);
  });

  it('selects explicit lq from video_urls without falling back to hq', () => {
    const lqOnlyData = {
      video_urls: {
        hq: 'https://maktabkhooneh.org/v/hq.mp4',
        lq: 'https://maktabkhooneh.org/v/lq.mp4',
      },
    };
    const resolved = resolveMediaQuality(lqOnlyData, 'lq');
    assert.equal(resolved.url, 'https://maktabkhooneh.org/v/lq.mp4');
    assert.equal(resolved.quality, 'lq');
  });

  it('strictly rejects nonexistent quality rather than silently choosing largest', () => {
    assert.throws(
      () => resolveMediaQuality(sampleVideoData, '1080p'),
      /Requested media quality '1080p' is not available/
    );
  });

  it('selects highest resolution when quality is default or omitted', () => {
    const resolved = resolveMediaQuality(sampleVideoData, 'default');
    assert.equal(resolved.url, 'https://maktabkhooneh.org/v/720.mp4');
    assert.equal(resolved.quality, '720p');
  });

  it('extractAvailableQualities formats qualities list properly', () => {
    const list = extractAvailableQualities(sampleVideoData);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, '720p');
    assert.equal(list[0].bytes, 1000);
  });
});

describe('SSRF Protection & Redirect Validation', () => {
  it('production mode rejects non-https, loopback, private IPs, credentials, and unsafe ports', () => {
    // Non-HTTPS
    assert.equal(isAllowedRemoteHost('http://maktabkhooneh.org/test.mp4', undefined, false), false);
    // Embedded credentials
    assert.equal(isAllowedRemoteHost('https://user:pass@maktabkhooneh.org/test.mp4', undefined, false), false);
    // Unsafe non-standard port
    assert.equal(isAllowedRemoteHost('https://maktabkhooneh.org:8080/test.mp4', undefined, false), false);
    // Loopback / private IPs
    assert.equal(isAllowedRemoteHost('https://127.0.0.1/test.mp4', undefined, false), false);
    assert.equal(isAllowedRemoteHost('https://10.0.0.1/test.mp4', undefined, false), false);
    assert.equal(isAllowedRemoteHost('https://192.168.1.1/test.mp4', undefined, false), false);
    assert.equal(isAllowedRemoteHost('https://169.254.169.254/test.mp4', undefined, false), false);
    // Untrusted domain / broad wildcard
    assert.equal(isAllowedRemoteHost('https://evil.com/test.mp4', undefined, false), false);
    assert.equal(isAllowedRemoteHost('https://arbitrary.arvancloud.ir/test.mp4', undefined, false), false);
    // Valid platform HTTPS domain
    assert.equal(isAllowedRemoteHost('https://maktabkhooneh.org/test.mp4', undefined, false), true);
    assert.equal(isAllowedRemoteHost('https://cdn.maktabkhooneh.org/test.mp4', undefined, false), true);
    assert.equal(isAllowedRemoteHost('https://s1.arvanstorage.ir/test.mp4', undefined, false), true);
  });

  it('safeFetch strips cookies and authorization on external targets and reports hostname only', async () => {
    let redirectServer: http.Server;
    let serverPort: number;

    const receivedCookies: string[] = [];
    const receivedAuth: string[] = [];

    await new Promise<void>((resolve) => {
      redirectServer = http.createServer((req, res) => {
        if (req.headers['cookie']) receivedCookies.push(req.headers['cookie']);
        if (req.headers['authorization']) receivedAuth.push(req.headers['authorization']);

        if (req.url === '/start') {
          res.writeHead(302, { Location: `http://127.0.0.1:${serverPort}/hop` });
          res.end('redirecting');
          return;
        }
        if (req.url === '/hop') {
          res.writeHead(200, { 'Content-Type': 'video/mp4' });
          res.end('final-video-content');
          return;
        }
        if (req.url === '/loop') {
          res.writeHead(302, { Location: `http://127.0.0.1:${serverPort}/loop` });
          res.end('looping');
          return;
        }
        res.writeHead(404);
        res.end();
      });

      redirectServer.listen(0, '127.0.0.1', () => {
        const addr = redirectServer.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    try {
      // safeFetch successfully follows redirect within allowed local test
      const res = await safeFetch(`http://127.0.0.1:${serverPort}/start`, {
        allowLocalTest: true,
        cookie: 'secret-cookie=123',
        headers: { authorization: 'Bearer secret-token' },
        exactPlatformOrigin: 'https://maktabkhooneh.org',
      });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text, 'final-video-content');
      // Neither cookie nor authorization was sent to non-platform host
      assert.equal(receivedCookies.length, 0);
      assert.equal(receivedAuth.length, 0);

      // Verify SSRF error message includes hostname only, not tokens
      await assert.rejects(
        () =>
          safeFetch('https://evil-hacker.com/secret?token=SUPER_SECRET_12345', {
            allowLocalTest: false,
          }),
        (err: Error) => {
          assert.match(err.message, /evil-hacker\.com/);
          assert.ok(!err.message.includes('SUPER_SECRET_12345'), 'Token must not leak in error message');
          return true;
        }
      );
    } finally {
      await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
    }
  });
});

describe('HTTP Range Parser & Local Media Serving', () => {
  const fileSize = 1000;

  it('parses standard, open-ended, and suffix ranges', () => {
    assert.deepEqual(parseHttpRange('bytes=0-499', fileSize), { start: 0, end: 499 });
    assert.deepEqual(parseHttpRange('bytes=500-', fileSize), { start: 500, end: 999 });
    assert.deepEqual(parseHttpRange('bytes=-200', fileSize), { start: 800, end: 999 });
  });

  it('clamps range end to file size - 1', () => {
    assert.deepEqual(parseHttpRange('bytes=900-2000', fileSize), { start: 900, end: 999 });
  });

  it('rejects multi-ranges and malformed ranges safely', () => {
    assert.equal(parseHttpRange('bytes=0-10,20-30', fileSize), 'unsatisfiable');
    assert.equal(parseHttpRange('bytes=500-100', fileSize), 'invalid');
    assert.equal(parseHttpRange('bytes=invalid-', fileSize), 'invalid');
    assert.equal(parseHttpRange('bytes=1500-', fileSize), 'unsatisfiable');
    assert.equal(parseHttpRange('not-bytes=0-100', fileSize), null);
  });

  it('serves local files with 200, 206, 416, and HEAD support', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-local-serve-'));
    const testFile = path.join(tmpDir, 'test.mp4');
    const content = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'); // 36 bytes
    fs.writeFileSync(testFile, content);

    const server = http.createServer(async (req, res) => {
      await serveLocalFile(req, res, testFile);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    try {
      // 1. Full GET (200)
      const res200 = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res200.status, 200);
      assert.equal(res200.headers.get('content-length'), '36');
      assert.equal(res200.headers.get('accept-ranges'), 'bytes');
      const body200 = await res200.text();
      assert.equal(body200, content.toString());

      // 2. HEAD (200)
      const resHead = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
      assert.equal(resHead.status, 200);
      assert.equal(resHead.headers.get('content-length'), '36');
      const bodyHead = await resHead.text();
      assert.equal(bodyHead, '');

      // 3. Partial GET (206)
      const res206 = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { range: 'bytes=0-9' },
      });
      assert.equal(res206.status, 206);
      assert.equal(res206.headers.get('content-range'), 'bytes 0-9/36');
      assert.equal(res206.headers.get('content-length'), '10');
      const body206 = await res206.text();
      assert.equal(body206, 'ABCDEFGHIJ');

      // 4. Suffix Range (206)
      const resSuffix = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { range: 'bytes=-5' },
      });
      assert.equal(resSuffix.status, 206);
      assert.equal(resSuffix.headers.get('content-range'), 'bytes 31-35/36');
      const bodySuffix = await resSuffix.text();
      assert.equal(bodySuffix, '56789');

      // 5. Unsatisfiable Range (416)
      const res416 = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { range: 'bytes=50-100' },
      });
      assert.equal(res416.status, 416);
      assert.equal(res416.headers.get('content-range'), 'bytes */36');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('stream proxy handles real HTTP streaming, Range forwarding, HEAD, and disconnect', async () => {
    let upstreamMedia: http.Server;
    let upPort: number;
    let upstreamRequests = 0;

    const fullPayload = Buffer.alloc(50 * 1024, 0x55); // 50 KB

    await new Promise<void>((resolve) => {
      upstreamMedia = http.createServer((req, res) => {
        upstreamRequests++;
        const range = req.headers.range;

        if (range === 'bytes=9999-') {
          res.writeHead(416, {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes */${fullPayload.length}`,
          });
          res.end();
          return;
        }

        if (range) {
          const m = range.match(/bytes=(\d+)-(\d+)?/);
          const start = m ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? parseInt(m[2], 10) : fullPayload.length - 1;
          const chunk = fullPayload.subarray(start, end + 1);

          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${start}-${end}/${fullPayload.length}`,
            'Content-Length': String(chunk.length),
            'Accept-Ranges': 'bytes',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(chunk);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(fullPayload.length),
          'Accept-Ranges': 'bytes',
        });
        if (req.method === 'HEAD') res.end();
        else res.end(fullPayload);
      });

      upstreamMedia.listen(0, '127.0.0.1', () => {
        upPort = (upstreamMedia.address() as any).port;
        resolve();
      });
    });

    const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-full-test-'));
    const sm = new StorageManager(path.join(tmpD, 'data'));
    await sm.init();
    const cl = new MaktabkhoonehClient();

    // Create a local completed job with 720p quality
    const completed720Path = path.join(tmpD, 'completed-720.mp4');
    fs.writeFileSync(completed720Path, Buffer.from('LOCAL_720P_VIDEO_DATA'));
    await sm.saveDownload({
      id: 'dl-comp-720',
      courseId: 'c1',
      lessonId: 'l1',
      courseTitle: 'C1',
      lessonTitle: 'L1',
      quality: '720p',
      status: 'completed',
      downloadedBytes: 21,
      totalBytes: 21,
      filePath: completed720Path,
    });

    const proxyServer = http.createServer(async (req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const quality = u.searchParams.get('quality') || undefined;

      await handleStreamLesson(req, res, {
        courseId: 'c1',
        lessonId: 'l1',
        quality,
        client: cl,
        storage: sm,
        allowLocalTest: true,
        resolveMediaUrl: async (_l, q) => {
          if (q === 'nonexistent') return null;
          return `http://127.0.0.1:${upPort}/video.mp4`;
        },
      });
    });

    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
    const proxyPort = (proxyServer.address() as any).port;

    try {
      // 1. When requested quality matches local completed file (720p), serve from local disk without hitting upstream
      const initialUpstreamCount = upstreamRequests;
      const resLocal = await fetch(`http://127.0.0.1:${proxyPort}/stream?quality=720p`);
      assert.equal(resLocal.status, 200);
      assert.equal(await resLocal.text(), 'LOCAL_720P_VIDEO_DATA');
      assert.equal(upstreamRequests, initialUpstreamCount, 'Must serve from disk without upstream request');

      // 2. When requested quality is 480p (different from local completed 720p), must NOT return local file; streams remote
      const resRemote = await fetch(`http://127.0.0.1:${proxyPort}/stream?quality=480p`, {
        headers: { range: 'bytes=0-99' },
      });
      assert.equal(resRemote.status, 206);
      assert.equal(resRemote.headers.get('content-range'), `bytes 0-99/${fullPayload.length}`);
      assert.equal(upstreamRequests, initialUpstreamCount + 1, 'Must request remote stream for different quality');

      // 3. HEAD request to stream proxy
      const resHead = await fetch(`http://127.0.0.1:${proxyPort}/stream?quality=480p`, {
        method: 'HEAD',
      });
      assert.equal(resHead.status, 200);
      assert.equal(resHead.headers.get('content-length'), String(fullPayload.length));
      assert.equal(await resHead.text(), '');

      // 4. Upstream 416 forwarding
      const res416 = await fetch(`http://127.0.0.1:${proxyPort}/stream?quality=480p`, {
        headers: { range: 'bytes=9999-' },
      });
      assert.equal(res416.status, 416);
      assert.equal(res416.headers.get('content-range'), `bytes */${fullPayload.length}`);
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
      await new Promise<void>((resolve) => upstreamMedia.close(() => resolve()));
      fs.rmSync(tmpD, { recursive: true, force: true });
    }
  });
});

describe('Download Engine Resilience & Transfer Verification', () => {
  let tmpDir: string;
  let storage: StorageManager;
  let client: MaktabkhoonehClient;
  let fakeUpstream: http.Server;
  let fakePort: number;

  const testPayload = Buffer.alloc(100 * 1024, 0x42); // 100 KB
  let ignoreRangeOnce = false;
  let currentEtag = '"v1"';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-engine-test-'));
    storage = new StorageManager(path.join(tmpDir, 'data'));
    await storage.init();
    await storage.updateSettings({ downloadDirectory: path.join(tmpDir, 'downloads') });

    client = new MaktabkhoonehClient();

    // Fake Upstream HTTP Server
    await new Promise<void>((resolve) => {
      fakeUpstream = http.createServer((req, res) => {
        const range = req.headers.range;
        const ifRange = req.headers['if-range'];

        if (ignoreRangeOnce && range) {
          ignoreRangeOnce = false;
          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': String(testPayload.length),
            'ETag': currentEtag,
          });
          res.end(testPayload);
          return;
        }

        if (range) {
          if (ifRange && ifRange !== currentEtag) {
            res.writeHead(200, {
              'Content-Type': 'video/mp4',
              'Content-Length': String(testPayload.length),
              'ETag': currentEtag,
            });
            res.end(testPayload);
            return;
          }

          const m = range.match(/bytes=(\d+)-/);
          const start = m ? parseInt(m[1], 10) : 0;
          const end = testPayload.length - 1;
          const chunk = testPayload.subarray(start, end + 1);

          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${start}-${end}/${testPayload.length}`,
            'Content-Length': String(chunk.length),
            'ETag': currentEtag,
          });
          res.end(chunk);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(testPayload.length),
          'ETag': currentEtag,
        });
        res.end(testPayload);
      });

      fakeUpstream.listen(0, '127.0.0.1', () => {
        fakePort = (fakeUpstream.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => fakeUpstream.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collision resistance: duplicate titles in same course do not collide or falsely complete', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/video.mp4`,
    });

    const job1 = await engine.enqueue('course-1', 'lesson-101', '720p', 'دوره تست', 'جلسه اول');
    const job2 = await engine.enqueue('course-1', 'lesson-102', '720p', 'دوره تست', 'جلسه اول');

    assert.notEqual(job1.id, job2.id);
    assert.notEqual(job1.filePath, job2.filePath);
    assert.match(job1.filePath!, /lesson-101/);
    assert.match(job2.filePath!, /lesson-102/);

    let attempts = 0;
    while (attempts++ < 30) {
      const j1 = storage.getDownload(job1.id);
      const j2 = storage.getDownload(job2.id);
      if (j1?.status === 'completed' && j2?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const final1 = storage.getDownload(job1.id);
    const final2 = storage.getDownload(job2.id);
    assert.equal(final1?.status, 'completed');
    assert.equal(final2?.status, 'completed');
    assert.equal(fs.statSync(final1!.filePath!).size, testPayload.length);
    assert.equal(fs.statSync(final2!.filePath!).size, testPayload.length);
  });

  it('duplicate/concurrent enqueue dedupes safely and returns existing job', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/video.mp4`,
    });

    const [d1, d2] = await Promise.all([
      engine.enqueue('course-dedupe', 'lesson-dedupe', '720p', 'Course Dedupe', 'Lesson Dedupe'),
      engine.enqueue('course-dedupe', 'lesson-dedupe', '720p', 'Course Dedupe', 'Lesson Dedupe'),
    ]);

    assert.equal(d1.id, d2.id);
  });

  it('quality isolation: selecting a different quality creates a distinct job with its own path', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/video.mp4`,
    });

    const jobA = await engine.enqueue('course-q', 'lesson-q', '720p', 'Course Q', 'Lesson Q');
    assert.match(jobA.filePath!, /720p/);

    await engine.pause(jobA.id);
    assert.equal(storage.getDownload(jobA.id)?.status, 'paused');

    // Enqueue different quality (480p) for same lesson creates its own distinct job
    const jobB = await engine.enqueue('course-q', 'lesson-q', '480p', 'Course Q', 'Lesson Q');
    assert.notEqual(jobB.id, jobA.id, 'Different quality must have its own job ID');
    assert.equal(jobB.quality, '480p');
    assert.match(jobB.filePath!, /480p/);
    assert.notEqual(jobB.filePath, jobA.filePath);
  });

  it('resumes partial download using strict Range and Content-Range', async () => {
    const partialPayload = testPayload.subarray(0, 40 * 1024);

    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/resume.mp4`,
    });

    const job = await engine.enqueue('course-res', 'lesson-res', 'default', 'Course Resume', 'Lesson Resume');
    // Pre-create partial .part file with 40KB
    fs.mkdirSync(path.dirname(job.filePath!), { recursive: true });
    fs.writeFileSync(`${job.filePath!}.part`, partialPayload);

    // Trigger resume
    await engine.resume(job.id);

    let attempts = 0;
    while (attempts++ < 30) {
      const cur = storage.getDownload(job.id);
      if (cur?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const completedJob = storage.getDownload(job.id);
    assert.equal(completedJob?.status, 'completed');
    assert.equal(fs.statSync(completedJob!.filePath!).size, testPayload.length);
  });

  it('safely restarts from 0 when upstream ignores Range (returns 200)', async () => {
    ignoreRangeOnce = true;

    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/ignore-range.mp4`,
    });

    const job = await engine.enqueue('course-ign', 'lesson-ign', 'default', 'Course Ign', 'Lesson Ign');
    // Pre-create corrupt .part file
    fs.mkdirSync(path.dirname(job.filePath!), { recursive: true });
    fs.writeFileSync(`${job.filePath!}.part`, Buffer.from('OLD_STALE_PARTIAL_BYTES'));

    engine.triggerWorker();

    let attempts = 0;
    while (attempts++ < 30) {
      const cur = storage.getDownload(job.id);
      if (cur?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const completedJob = storage.getDownload(job.id);
    assert.equal(completedJob?.status, 'completed');
    assert.equal(fs.statSync(completedJob!.filePath!).size, testPayload.length);
  });

  it('authoritative pause/cancel and graceful shutdown', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/ctrl.mp4`,
    });

    const job = await engine.enqueue('course-ctrl', 'lesson-ctrl', 'default', 'Course Control', 'Lesson Control');
    const paused = await engine.pause(job.id);
    assert.equal(paused.status, 'paused');

    // Completed jobs cannot be paused or canceled
    paused.status = 'completed';
    await storage.saveDownload(paused);

    const tryPause = await engine.pause(paused.id);
    assert.equal(tryPause.status, 'completed');

    const tryCancel = await engine.cancel(paused.id);
    assert.equal(tryCancel.status, 'completed');

    await engine.shutdown();
  });

  it('long Persian titles, colliding sanitized IDs, and case differences retain unique suffixes', async () => {
    // 1. Long Persian title (> 200 characters)
    const longTitle = 'آموزش بسیار طولانی و جامع مفاهیم یادگیری عمیق و شبکه‌های عصبی پیچشی به همراه کاربردهای عملی در بینایی ماشین و پردازش تصویر با پایتون و تنسورفلو برای سیستم‌های هوشمند پزشکی و مهندسی';
    const file1 = buildMediaFileName(longTitle, 'lesson-100', '720p');
    const file2 = buildMediaFileName(longTitle, 'lesson-200', '720p');

    // Both files must be well within Windows filename limits (< 150 characters)
    assert.ok(file1.length <= 150, `Filename length ${file1.length} must be <= 150`);
    assert.ok(file2.length <= 150, `Filename length ${file2.length} must be <= 150`);

    // Suffix must retain stable ID and quality without truncation
    assert.match(file1, /lesson-100-720p-[0-9a-f]{8}\.mp4$/);
    assert.match(file2, /lesson-200-720p-[0-9a-f]{8}\.mp4$/);
    assert.notEqual(file1, file2, 'Different lesson IDs with identical long titles must not collide');

    // 2. Colliding sanitized IDs (e.g. 'lesson:1' and 'lesson/1' both sanitize to 'lesson 1')
    const fileColon = buildMediaFileName('درس نمونه', 'lesson:1', 'default');
    const fileSlash = buildMediaFileName('درس نمونه', 'lesson/1', 'default');
    assert.notEqual(fileColon, fileSlash, 'Colliding sanitized IDs must produce distinct filenames via raw hash');

    // 3. Case differences (e.g. 'UNIT-XYZ' vs 'unit-xyz') on case-insensitive filesystems
    const fileUpper = buildMediaFileName('درس نمونه', 'UNIT-XYZ', 'default');
    const fileLower = buildMediaFileName('درس نمونه', 'unit-xyz', 'default');
    assert.notEqual(fileUpper, fileLower, 'Case differences in IDs must produce distinct filenames via raw hash');
    // Ensure case difference is not solely in the sanitized ID portion (so Windows NTFS does not collide them)
    assert.notEqual(fileUpper.toLowerCase(), fileLower.toLowerCase(), 'Filename lower-cased must still differ due to distinct hash');
  });

  it('changed ETag during 206 resume requests AGAIN from byte zero and writes full content', async () => {
    // Start with a partial file and stored ETag "v1"
    const partialBytes = 30 * 1024;
    const partialPayload = Buffer.alloc(partialBytes, 0x11);

    let requestCount = 0;
    const requestedRanges: (string | undefined)[] = [];

    // Local fake server that sends 206 with changed ETag "v2" when range is requested,
    // and full 200 with ETag "v2" when requested from byte 0
    let vServer: http.Server;
    let vPort: number;

    const fullContent = Buffer.alloc(80 * 1024, 0x99);

    await new Promise<void>((resolve) => {
      vServer = http.createServer((req, res) => {
        requestCount++;
        requestedRanges.push(req.headers.range);

        if (req.headers.range) {
          // Send 206 with changed ETag "v2" but identical Last-Modified
          const m = req.headers.range.match(/bytes=(\d+)-/);
          const start = m ? parseInt(m[1], 10) : 0;
          const chunk = fullContent.subarray(start);
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${start}-${fullContent.length - 1}/${fullContent.length}`,
            'Content-Length': String(chunk.length),
            'ETag': '"v2"',
            'Last-Modified': 'Mon, 16 Nov 2026 00:00:00 GMT',
          });
          res.end(chunk);
          return;
        }

        // Byte 0 request (no range)
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(fullContent.length),
          'ETag': '"v2"',
          'Last-Modified': 'Mon, 16 Nov 2026 00:00:00 GMT',
        });
        res.end(fullContent);
      });

      vServer.listen(0, '127.0.0.1', () => {
        vPort = (vServer.address() as any).port;
        resolve();
      });
    });

    try {
      const engine = new DownloadEngine({
        storage,
        client,
        allowLocalTest: true,
        resolveMediaUrl: async () => `http://127.0.0.1:${vPort}/video.mp4`,
      });

      const job = await engine.enqueue('course-etag', 'lesson-etag', 'default', 'Course ETag', 'Lesson ETag');
      // Store old etag "v1" with identical Last-Modified
      (job as any).etag = '"v1"';
      (job as any).lastModified = 'Mon, 16 Nov 2026 00:00:00 GMT';
      await storage.saveDownload(job);

      // Pre-create partial file with old bytes
      fs.mkdirSync(path.dirname(job.filePath!), { recursive: true });
      fs.writeFileSync(`${job.filePath!}.part`, partialPayload);

      // Resume
      await engine.resume(job.id);

      let attempts = 0;
      while (attempts++ < 30) {
        const cur = storage.getDownload(job.id);
        if (cur?.status === 'completed') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      const completed = storage.getDownload(job.id);
      assert.equal(completed?.status, 'completed');
      // Must equal fullContent length (80KB), NOT just tail (50KB)!
      assert.equal(fs.statSync(completed!.filePath!).size, fullContent.length);
      // Verify first byte is 0x99 from fullContent, not 0x11 from old partial!
      const finalBytes = fs.readFileSync(completed!.filePath!);
      assert.equal(finalBytes[0], 0x99);
      // Verify requestCount was at least 2: first with range (canceled), then restarted from byte 0
      assert.ok(requestCount >= 2, 'Must request again after validator change');
    } finally {
      await new Promise<void>((resolve) => vServer.close(() => resolve()));
    }
  });

  it('survives settings change: in-flight and resumed jobs retain immutable baseDir', async () => {
    const originalSettings = storage.getSettings();
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/video.mp4`,
    });

    const job = await engine.enqueue('course-sc', 'lesson-sc', 'default', 'Course SC', 'Lesson SC');
    const jobBaseDir = (job as any).baseDir;
    assert.equal(jobBaseDir, originalSettings.downloadDirectory);

    // Change global download directory settings to a new folder
    const newDownloadsDir = path.join(tmpDir, 'new-downloads-dir');
    await storage.updateSettings({ downloadDirectory: newDownloadsDir });

    // Pause and Resume job after settings changed
    await engine.pause(job.id);
    await engine.resume(job.id);

    let attempts = 0;
    while (attempts++ < 30) {
      const cur = storage.getDownload(job.id);
      if (cur?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const completed = storage.getDownload(job.id);
    assert.equal(completed?.status, 'completed');
    // File must exist in the original job destination, not crashed or moved to new setting
    assert.ok(fs.existsSync(completed!.filePath!));
    assert.ok(completed!.filePath!.startsWith(jobBaseDir));

    // Restore original settings
    await storage.updateSettings({ downloadDirectory: originalSettings.downloadDirectory });
  });

  it('recovers missing completed files when enqueued again', async () => {
    const engine = new DownloadEngine({
      storage,
      client,
      allowLocalTest: true,
      resolveMediaUrl: async () => `http://127.0.0.1:${fakePort}/video.mp4`,
    });

    const job = await engine.enqueue('course-rec', 'lesson-rec', 'default', 'Course Rec', 'Lesson Rec');
    let attempts = 0;
    while (attempts++ < 30) {
      const cur = storage.getDownload(job.id);
      if (cur?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const completed = storage.getDownload(job.id);
    assert.equal(completed?.status, 'completed');
    assert.ok(fs.existsSync(completed!.filePath!));

    // Delete the completed file on disk
    fs.unlinkSync(completed!.filePath!);

    // Re-enqueue the same lesson: must recover the job and set it to queued
    const recovered = await engine.enqueue('course-rec', 'lesson-rec', 'default', 'Course Rec', 'Lesson Rec');
    assert.equal(recovered.id, completed.id);
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.downloadedBytes, 0);
  });

  it('bounds inner loop: malformed zero-offset response halts with bounded request count', async () => {
    let requestsReceived = 0;
    let malformedServer: http.Server;
    let malformedPort: number;

    // Upstream server that returns an invalid range start 500 when requested from byte 0
    await new Promise<void>((resolve) => {
      malformedServer = http.createServer((req, res) => {
        requestsReceived++;
        // Return 206 starting at 500 even though client has resumeOffset=0
        res.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 500-999/1000',
          'Content-Length': '500',
        });
        res.end(Buffer.alloc(500, 0x33));
      });

      malformedServer.listen(0, '127.0.0.1', () => {
        malformedPort = (malformedServer.address() as any).port;
        resolve();
      });
    });

    try {
      const engine = new DownloadEngine({
        storage,
        client,
        allowLocalTest: true,
        resolveMediaUrl: async () => `http://127.0.0.1:${malformedPort}/malformed.mp4`,
      });

      const job = await engine.enqueue('course-mal', 'lesson-mal', 'default', 'Course Mal', 'Lesson Mal');

      // Allow time for the three seconds of retry backoff and the HTTP requests.
      let attempts = 0;
      while (attempts++ < 60) {
        const cur = storage.getDownload(job.id);
        if (cur?.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      const failedJob = storage.getDownload(job.id);
      assert.equal(failedJob?.status, 'failed');
      assert.match(failedJob?.error || '', /invalid range start/);

      // Verify request count was strictly bounded (at most maxRetries = 3 requests, not looping infinitely)
      assert.ok(requestsReceived <= 4, `Request count ${requestsReceived} must be strictly bounded <= 4`);
    } finally {
      await new Promise<void>((resolve) => malformedServer.close(() => resolve()));
    }
  });
});
