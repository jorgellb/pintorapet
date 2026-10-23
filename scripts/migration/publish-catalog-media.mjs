#!/usr/bin/env node
/**
 * Copy verified catalog downloads into public/media/catalog/ for local/SSR serving.
 * Generated files are gitignored — run after fetch-assets.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assetsPath = path.join(root, 'migration', 'assets.json');
const outDir = path.join(root, 'public', 'media', 'catalog');

function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(filename || '');
  return (m?.[1] || 'jpg').toLowerCase();
}

async function main() {
  const doc = JSON.parse(await readFile(assetsPath, 'utf8'));
  await mkdir(outDir, { recursive: true });
  const published = [];
  for (const asset of doc.assets ?? []) {
    if (asset.status !== 'ok' || !asset.localPath) continue;
    const src = path.join(root, asset.localPath);
    const ext = extOf(asset.originalFilename || asset.file);
    const destName = `${asset.legacyId}.${ext}`;
    const dest = path.join(outDir, destName);
    await copyFile(src, dest);
    const publicUrl = `/media/catalog/${destName}`;
    published.push({
      legacyId: asset.legacyId,
      publicUrl,
      sha256: asset.sha256,
      bytes: asset.bytes,
      originalFilename: asset.originalFilename,
    });
  }
  await writeFile(
    path.join(root, 'migration', 'media-public.json'),
    JSON.stringify(
      { publishedAt: new Date().toISOString(), count: published.length, assets: published },
      null,
      2,
    ) + '\n',
  );
  console.log(`Published ${published.length} catalog images → public/media/catalog/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
