import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const title = 'Maktabkhooneh Study Library';
const mac = process.platform === 'darwin';
const args = process.argv.slice(2);
const backend = fileURLToPath(new URL('./desktop.mjs', import.meta.url));
const environment = { ...process.env, NODE_ENV: 'production' };
delete environment.NODE_OPTIONS;
delete environment.NODE_PATH;

function dialog(message, button) {
  if (mac) {
    const script = [
      'on run argv',
      'activate',
      'set actionLabel to item 3 of argv',
      'display dialog (item 1 of argv) with title (item 2 of argv) buttons {actionLabel} default button 1',
      'end run',
    ].join('\n');
    return spawn('/usr/bin/osascript', ['-e', script, message, title, button], { stdio: 'ignore' });
  }
  return spawn('zenity', [
    button === 'Quit' ? '--info' : '--error', '--no-markup',
    '--title', title, '--text', message, '--ok-label', button,
  ], { stdio: 'ignore' });
}

const child = spawn(process.execPath, [backend, ...args.filter((arg) => arg !== '--no-open')], {
  env: environment,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const finished = once(child, 'close');
child.stdin.on('error', () => {});
let startupError = 'Could not start the local dashboard. Check that the package is intact and the data directory is writable.';
child.stderr.setEncoding('utf8').on('data', (text) => {
  if (text.includes('EADDRINUSE')) {
    startupError = 'The local port is already in use. Close the other dashboard or app using it, then reopen.';
  }
});

const lines = createInterface({ input: child.stdout });
async function waitForUrl() {
  for await (const line of lines) {
    const ready = /^READY (http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/)$/u.exec(line);
    if (ready && Number(ready[2]) <= 65535) return ready[1];
  }
  await finished;
  throw new Error(startupError);
}

let status;
let stopping = false;
function requestStop() {
  stopping = true;
  status?.kill();
  child.stdin.end();
}
process.once('SIGINT', requestStop);
process.once('SIGTERM', requestStop);

try {
  const url = await Promise.race([
    waitForUrl(),
    delay(15000, undefined, { ref: false }).then(() => { throw new Error(startupError); }),
  ]);
  if (!stopping) {
    if (!args.includes('--no-open')) {
      const browser = spawn(mac ? '/usr/bin/open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
      browser.on('error', () => {});
      browser.unref();
    }
    status = dialog(`Your local dashboard is running at ${url}\n\nKeep this window open while studying.`, 'Quit');
    await Promise.race([
      once(status, 'close'),
      finished.then(() => { if (!stopping) throw new Error('The local dashboard stopped unexpectedly.'); }),
    ]);
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    status?.kill();
    await once(dialog(error.message, 'OK'), 'close').catch(() => {});
    process.exitCode = 1;
  }
} finally {
  lines.close();
  requestStop();
  const exited = await Promise.race([finished.then(() => true, () => true), delay(5000, false, { ref: false })]);
  if (!exited) {
    child.kill('SIGKILL');
    await finished;
  }
}
