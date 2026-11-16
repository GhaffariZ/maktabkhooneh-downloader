import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AppServer } from '../../../server/server.js';

test('the mobile WebView handshake protects streaming and offline files', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mk-mobile-test-'));
  const token = 'a'.repeat(64);
  const server = new AppServer({ port: 0, dataDir, isDemo: true, mobileAccessToken: token });
  const { port, host } = await server.start();
  const origin = `http://${host}:${port}`;

  try {
    for (const route of ['/', '/api/bootstrap', '/api/courses', '/api/downloads/no-id/media']) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 403, route);
      await response.arrayBuffer();
    }

    const wrongToken = await fetch(`${origin}/__mobile/start`, {
      headers: { 'X-MK-Mobile-Token': 'b'.repeat(64) },
    });
    assert.equal(wrongToken.status, 403);
    assert.equal(wrongToken.headers.get('Set-Cookie'), null);
    await wrongToken.arrayBuffer();

    const bootstrap = await fetch(`${origin}/__mobile/start`, {
      headers: { 'X-MK-Mobile-Token': token },
      redirect: 'manual',
    });
    assert.equal(bootstrap.status, 303);
    assert.equal(bootstrap.headers.get('Location'), '/');
    const cookie = bootstrap.headers.get('Set-Cookie');
    assert.ok(cookie?.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Strict'));
    const headers = { Cookie: cookie.split(';')[0] };

    const settings = await fetch(`${origin}/api/settings`, { headers });
    assert.equal(settings.status, 200);
    assert.deepEqual(await settings.json(), {
      downloadDirectory: path.join(dataDir, 'demo', 'downloads'),
      downloadDirectoryManaged: true,
    });

    const download = await fetch(`${origin}/api/downloads`, {
      method: 'POST',
      headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: 'demo-python', lessonId: 'demo-unit-101', quality: 'demo-720p' }),
    });
    assert.equal(download.status, 201);
    const { download: { id } } = await download.json();
    const mediaPath = `${origin}/api/downloads/${id}/media`;

    const denied = await fetch(mediaPath, { headers: { Range: 'bytes=0-99' } });
    assert.equal(denied.status, 403);
    await denied.arrayBuffer();
    const offline = await fetch(mediaPath, { headers: { ...headers, Range: 'bytes=0-99' } });
    assert.equal(offline.status, 206);
    assert.equal((await offline.arrayBuffer()).byteLength, 100);
  } finally {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});
