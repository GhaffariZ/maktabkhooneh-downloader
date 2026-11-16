import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { packages } = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['Third-party notices for Maktabkhooneh Study Library'];

for (const [directory, metadata] of Object.entries(packages)) {
  if (!directory.startsWith('node_modules/') || metadata.dev) continue;
  const files = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const licensePaths = files.filter((name) => /^(licen[cs]e|notice|copying|ofl)([._-]|$)/iu.test(name))
    .sort().map((name) => path.join(directory, name));
  // The npm compiler runtime omits its license from the tarball. It uses React's MIT license.
  if (directory === 'node_modules/react-compiler-runtime' && !licensePaths.length) {
    licensePaths.push('node_modules/react/LICENSE');
  }
  if (licensePaths.length) {
    notices.push(`${directory.replace(/^.*node_modules\//u, '')}@${metadata.version}`);
    for (const file of licensePaths) notices.push((await readFile(file, 'utf8')).trimEnd());
  }
}

await writeFile(path.join('dist', 'client', 'THIRD-PARTY-LICENSES.txt'), `${notices.join('\n\n')}\n`);
