import fs from 'fs';
import path from 'path';

const src = path.resolve('server/demo/sample.mp4');
if (!fs.existsSync(src)) {
  console.error(`Asset source not found: ${src}`);
  process.exit(1);
}

const destinations = [
  path.resolve('dist/server/server/demo/sample.mp4'),
  path.resolve('dist/server/demo/sample.mp4'),
];

for (const dest of destinations) {
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Copied demo asset to ${dest}`);
}
