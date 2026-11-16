import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const packageDirectory = process.argv[2];
if (!packageDirectory) throw new Error('Usage: node scripts/smoke-desktop.mjs <extracted-package-directory>');

const root = path.resolve(packageDirectory);
const executable = process.platform === 'win32' ? 'node.exe' : 'node';
const data = await mkdtemp(path.join(tmpdir(), 'mk-desktop-smoke-'));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
const timeout = delay(15000, undefined, { ref: false }).then(() => {
  throw new Error('The packaged server did not respond within 15 seconds.');
});

function launch(port = '0', profile = data) {
  const child = spawn(path.join(root, 'runtime', executable), [
    path.join(root, 'scripts', 'desktop.mjs'), '--demo', '--port', port,
  ], {
    cwd: data,
    env: { ...environment, PATH: '', NODE_OPTIONS: '', NODE_PATH: '', MK_DESKTOP_DATA_DIR: profile },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (line) => { stderr += line; });
  const lines = createInterface({ input: child.stdout });
  const closed = once(child, 'close');
  return {
    child,
    closed,
    async ready() {
      const url = await Promise.race([
        (async () => {
          for await (const line of lines) {
            const match = /^READY (http:\/\/127\.0\.0\.1:\d+\/)\s*$/.exec(line);
            if (match) return match[1];
          }
          throw new Error(`The packaged server exited before it was ready. ${stderr}`);
        })(),
        timeout,
      ]);
      return new URL(url).origin;
    },
    async stop() {
      child.stdin.end();
      const [code] = await Promise.race([closed, timeout]);
      assert.equal(code, 0, stderr);
    },
  };
}

async function request(url, resource, status, options) {
  const response = await fetch(`${url}${resource}`, { ...options, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, status, resource);
  return response;
}

const processes = [];
try {
  const first = launch();
  processes.push(first);
  const url = await first.ready();
  const html = await (await request(url, '/', 200)).text();
  const asset = /src="(\/assets\/index-[^"/]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, 'The packaged dashboard references the built client bundle.');
  await (await request(url, asset, 200)).arrayBuffer();
  const session = await (await request(url, '/api/session', 200)).json();
  assert.equal(session.demo, true);

  const collision = launch(new URL(url).port, path.join(data, 'collision'));
  processes.push(collision);
  const [collisionCode] = await Promise.race([collision.closed, timeout]);
  assert.equal(collisionCode, 1, 'An occupied port is reported and the extra server exits.');

  const download = await (await request(url, '/api/downloads', 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId: 'demo-python', lessonId: 'demo-unit-101', quality: 'demo-720p' }),
  })).json();
  assert.equal(download.download.status, 'completed');
  await first.stop();

  const second = launch();
  processes.push(second);
  const restartedUrl = await second.ready();
  const media = await request(restartedUrl, `/api/downloads/${download.download.id}/media`, 206, {
    headers: { Range: 'bytes=0-99' },
  });
  assert.equal(media.headers.get('Content-Type'), 'video/mp4');
  assert.equal((await media.arrayBuffer()).byteLength, 100);
  await second.stop();
  console.log('Packaged client, demo download, offline restart, media seeking, and graceful shutdown passed.');
} finally {
  for (const instance of processes) {
    if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill();
    await instance.closed.catch(() => {});
  }
  await rm(data, { recursive: true, force: true });
}
