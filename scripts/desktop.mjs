import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppServer } from '../dist/server/server/server.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const clientDistDir = path.resolve(appRoot, 'dist', 'client');

const args = process.argv.slice(2);
const isDemo = args.includes('--demo');

let port = 3210;
const portIdx = args.indexOf('--port');
if (portIdx !== -1) {
  const value = args[portIdx + 1];
  if (!/^\d+$/.test(value ?? '') || Number(value) > 65535) {
    console.error('Choose a port from 0 to 65535.');
    process.exit(1);
  }
  port = Number(value);
}

const home = homedir();
const dataRoots = {
  win32: process.env.LOCALAPPDATA || process.env.APPDATA || path.join(home, 'AppData', 'Local'),
  darwin: path.join(home, 'Library', 'Application Support'),
  linux: path.isAbsolute(process.env.XDG_DATA_HOME ?? '')
    ? process.env.XDG_DATA_HOME
    : path.join(home, '.local', 'share'),
};
const dataDir = path.resolve(process.env.MK_DESKTOP_DATA_DIR ||
  path.join(dataRoots[process.platform] ?? home, 'Maktabkhooneh Study Library', 'data'));

let server;
try {
  server = new AppServer({
    port,
    isDemo,
    clientDistDir,
    dataDir,
  });
} catch (err) {
  console.error(`Failed to initialize application server: ${err?.message || err}`);
  process.exit(1);
}

let isShuttingDown = false;
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try {
    if (server) {
      await server.stop();
    }
    process.exit(0);
  } catch (error) {
    console.error(`Failed to stop local server: ${error.message}`);
    process.exit(1);
  }
}

// Handle signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  try {
    const info = await server.start();
    // Print READY exactly once after listen
    console.log(`READY http://127.0.0.1:${info.port}/`);

    // Gracefully stop via stdin EOF (closed standard input by launcher)
    if (!process.stdin.isTTY) {
      process.stdin.once('end', shutdown);
      process.stdin.once('close', shutdown);
      process.stdin.once('error', shutdown);
      process.stdin.resume();
    }
  } catch (err) {
    // If port is occupied (EADDRINUSE) or state setup fails
    if (err && (err.code === 'EADDRINUSE' || String(err.message).includes('EADDRINUSE'))) {
      console.error(`EADDRINUSE: Port ${port} is already in use by another application.`);
    } else {
      console.error(`Failed to start desktop server: ${err?.message || err}`);
    }

    process.exit(1);
  }
}

main();
