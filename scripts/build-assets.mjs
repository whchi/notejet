import { statSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

async function main() {
  await mkdir(path.join(DIST, 'src', 'popup'), { recursive: true });
  await mkdir(path.join(DIST, 'src', 'options'), { recursive: true });
  await mkdir(path.join(DIST, 'src', 'assets'), { recursive: true });

  await cp(path.join(ROOT, 'src', 'popup', 'popup.html'), path.join(DIST, 'src', 'popup', 'popup.html'));
  await cp(path.join(ROOT, 'src', 'popup', 'popup.css'), path.join(DIST, 'src', 'popup', 'popup.css'));
  await cp(path.join(ROOT, 'src', 'options', 'options.html'), path.join(DIST, 'src', 'options', 'options.html'));
  await cp(path.join(ROOT, 'src', 'options', 'options.css'), path.join(DIST, 'src', 'options', 'options.css'));
  await cp(path.join(ROOT, 'src', 'assets'), path.join(DIST, 'src', 'assets'), {
    recursive: true,
    filter: src => {
      const stats = statSync(src);
      if (stats.isDirectory()) {
        return true;
      }
      return src.endsWith('.png');
    },
  });

  const manifestRaw = await readFile(path.join(ROOT, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  await writeFile(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

await main();
