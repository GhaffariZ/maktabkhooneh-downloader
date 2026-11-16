import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [platform, runtimePath, licensePath] = process.argv.slice(2);
if (!['android', 'ios'].includes(platform) || !runtimePath || !licensePath) {
  throw new Error('Usage: node scripts/prepare-mobile.mjs <android|ios> <runtime.zip> <node-license.txt>');
}

const repo = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const lock = JSON.parse(await readFile(path.join(repo, 'mobile', 'runtime.json'), 'utf8'));
const archive = path.resolve(runtimePath);
const license = path.resolve(licensePath);

async function checkHash(file, expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error(`Checksum mismatch for ${path.basename(file)}`);
}

await Promise.all([
  checkHash(archive, lock[platform].sha256),
  checkHash(license, lock.license.sha256),
  access(path.join(repo, 'dist', 'server', 'server', 'server.js')),
  access(path.join(repo, 'dist', 'client', 'index.html')),
]);

const generated = path.join(repo, 'mobile', 'generated');
await mkdir(generated, { recursive: true });
if (path.relative(generated, await realpath(generated)) !== '') {
  throw new Error('The generated directory must be inside the repository.');
}
const work = await mkdtemp(path.join(generated, `${platform}-`));
try {
  const extracted = path.join(work, 'vendor');
  const target = path.join(work, 'target');
  const app = path.join(target, 'assets', 'app');
  const runtime = path.join(target, 'runtime');
  await Promise.all([extracted, app, runtime].map((directory) => mkdir(directory, { recursive: true })));
  const isWindows = process.platform === 'win32';
  const unpacked = spawnSync(isWindows ? 'tar.exe' : 'unzip',
    isWindows ? ['-xf', archive, '-C', extracted] : ['-q', archive, '-d', extracted], { stdio: 'inherit' });
  if (unpacked.error) throw unpacked.error;
  if (unpacked.status !== 0) throw new Error('Could not unpack the verified runtime.');

  await Promise.all([
    cp(path.join(repo, 'dist'), path.join(app, 'dist'), { recursive: true }),
    cp(path.join(repo, 'scripts', 'mobile.mjs'), path.join(app, 'mobile.mjs')),
    cp(path.join(repo, 'LICENSE'), path.join(app, 'LICENSE.txt')),
    cp(license, path.join(app, 'Node-LICENSE.txt')),
    writeFile(path.join(app, 'package.json'), '{"type":"module"}\n'),
  ]);

  if (platform === 'android') {
    await cp(path.join(extracted, 'include'), path.join(runtime, 'include'), { recursive: true });
    for (const abi of ['arm64-v8a', 'x86_64']) {
      const destination = path.join(runtime, 'lib', abi);
      await mkdir(destination, { recursive: true });
      await cp(path.join(extracted, 'bin', abi, 'libnode.so'), path.join(destination, 'libnode.so'));
    }
  } else {
    await cp(path.join(extracted, 'NodeMobile.xcframework'), path.join(runtime, 'NodeMobile.xcframework'), { recursive: true });
  }

  const output = path.join(generated, platform);
  const existing = await realpath(output).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && path.relative(output, existing) !== '') throw new Error('Invalid generated output path.');
  await rm(output, { recursive: true, force: true });
  await rename(target, output);
  console.log(`Prepared ${platform} assets and runtime in ${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
