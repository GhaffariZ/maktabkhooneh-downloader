#!/usr/bin/env node
/**
 * Cross-platform launcher for Maktabkhooneh Local Dashboard.
 * Enforces loopback binding, monitors child process errors,
 * uses compiled production server when built, and opens the user's browser.
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const noOpen =
  args.includes('--no-open') ||
  process.env.MK_NO_OPEN === '1' ||
  process.env.MK_NO_OPEN === 'true';

const isDemo =
  args.includes('--demo') ||
  process.env.MK_DEMO === '1' ||
  process.env.MK_DEMO === 'true';

let port = 3210;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  port = parseInt(args[portIdx + 1], 10) || 3210;
} else if (process.env.PORT) {
  port = parseInt(process.env.PORT, 10) || 3210;
}

// Requirement 7: Only loopback host is accepted, even if HOST env is set
const host = '127.0.0.1';
const targetUrl = `http://${host}:${port}`;

console.log(`Starting Maktabkhooneh Local Dashboard on ${targetUrl}...`);

// Check if compiled production server exists
const compiledMainPath = path.resolve(process.cwd(), 'dist', 'server', 'server', 'main.js');
const altCompiledMainPath = path.resolve(process.cwd(), 'dist', 'server', 'main.js');
let spawnArgs = [];

if (fs.existsSync(compiledMainPath)) {
  spawnArgs = [compiledMainPath];
} else if (fs.existsSync(altCompiledMainPath)) {
  spawnArgs = [altCompiledMainPath];
} else {
  spawnArgs = ['--import', 'tsx', 'server/main.ts'];
}

if (isDemo) {
  spawnArgs.push('--demo');
}

const isDev = args.includes('--dev');
if (isDev) {
  spawnArgs.push('--dev');
}

let childExited = false;
let childExitCode = 0;

const serverProcess = spawn(process.execPath, spawnArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(port),
    HOST: host,
    MK_DEMO: isDemo ? '1' : (process.env.MK_DEMO || '0'),
  },
});

serverProcess.on('error', (err) => {
  console.error(`Failed to start backend server process: ${err.message}`);
  process.exit(1);
});

serverProcess.on('exit', (code, signal) => {
  childExited = true;
  childExitCode = code ?? 0;
  if (code !== 0 && code !== null) {
    console.error(`Server process exited unexpectedly with code ${code}`);
    process.exit(code);
  }
});

function openBrowser(url) {
  if (noOpen) {
    console.log(`Browser auto-open disabled. Open ${url} in your browser.`);
    return;
  }

  const platform = process.platform;
  let cmd = '';
  let cmdArgs = [];

  if (platform === 'win32') {
    cmd = 'cmd.exe';
    cmdArgs = ['/c', 'start', '""', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [url];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [url];
  }

  try {
    const cp = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    cp.on('error', (err) => {
      console.warn(`Could not open browser automatically: ${err.message}`);
      console.log(`Open ${url} in your browser.`);
    });
    cp.unref();
  } catch (err) {
    console.warn(`Could not launch browser command: ${err.message}`);
    console.log(`Open ${url} in your browser.`);
  }
}

// Poll server until ready, aborting immediately if child process failed
let pollTimer = null;
function waitForServer(retries = 35) {
  if (childExited) {
    console.error('Cannot wait for server: backend process has exited.');
    process.exit(childExitCode || 1);
    return;
  }

  if (retries <= 0) {
    console.warn('Timed out waiting for server to be ready.');
    openBrowser(targetUrl);
    return;
  }

  const req = http.get(`${targetUrl}/api/session`, (res) => {
    if (res.statusCode === 200) {
      console.log(`Server is ready! Opening ${targetUrl}...`);
      openBrowser(targetUrl);
    } else {
      pollTimer = setTimeout(() => waitForServer(retries - 1), 200);
    }
  });

  req.on('error', () => {
    pollTimer = setTimeout(() => waitForServer(retries - 1), 200);
  });
}

pollTimer = setTimeout(() => waitForServer(), 300);

// Propagate shutdown
const cleanExit = () => {
  if (pollTimer) clearTimeout(pollTimer);
  serverProcess.kill('SIGINT');
  process.exit(0);
};

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
