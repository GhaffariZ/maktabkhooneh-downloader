import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppServer } from './dist/server/server/server.js';

const [dataDir, readyFile, mobileAccessToken, ...args] = process.argv.slice(2);
if (!path.isAbsolute(dataDir ?? '') || !path.isAbsolute(readyFile ?? '')) {
  throw new Error('The native launcher must supply private absolute paths.');
}

const server = new AppServer({
  port: 3210,
  isDemo: args.includes('--demo'),
  dataDir,
  clientDistDir: fileURLToPath(new URL('./dist/client/', import.meta.url)),
  mobileAccessToken: mobileAccessToken ?? '',
});

await mkdir(path.dirname(readyFile), { recursive: true });
const { host, port } = await server.start();
try {
  const tempFile = `${readyFile}.tmp`;
  await writeFile(tempFile, `http://${host}:${port}/`, { flag: 'wx', mode: 0o600 });
  await rename(tempFile, readyFile);
} catch (error) {
  await server.stop();
  throw error;
}
