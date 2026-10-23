#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_HASHES } from './expected-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const downloadDir = path.join(root, 'migration', 'downloads', 'catalog');

async function downloadOne(id, meta) {
  const res = await fetch(meta.url, {
    headers: { 'User-Agent': 'PetsDrawingsMigration/1.0 (+local rebuild)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    return {
      legacyId: Number(id),
      ...meta,
      status: 'error',
      httpStatus: res.status,
    };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const dest = path.join(downloadDir, `${id}-${meta.file}`);
  await writeFile(dest, buf);
  const match = sha256 === meta.sha256;
  return {
    legacyId: Number(id),
    originalFilename: meta.file,
    sourceUrl: meta.url,
    bytes: buf.length,
    sha256,
    expectedSha256: meta.sha256,
    hashMatch: match,
    localPath: path.relative(root, dest),
    status: match ? 'ok' : 'hash_mismatch',
  };
}

async function main() {
  await mkdir(downloadDir, { recursive: true });
  const entries = Object.entries(ASSET_HASHES);
  const assets = [];
  const concurrency = 4;
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(([id, meta]) =>
        downloadOne(id, meta).catch((err) => ({
          legacyId: Number(id),
          ...meta,
          status: 'error',
          error: String(err?.message || err),
        })),
      ),
    );
    assets.push(...results);
    console.log(`Downloaded ${Math.min(i + concurrency, entries.length)}/${entries.length}`);
  }

  const uniqueHashes = new Set(assets.filter((a) => a.sha256).map((a) => a.sha256));
  const out = {
    fetchedAt: new Date().toISOString(),
    expectedCount: entries.length,
    downloaded: assets.filter((a) => a.status === 'ok' || a.status === 'hash_mismatch').length,
    uniqueSha256: uniqueHashes.size,
    mismatches: assets.filter((a) => a.status === 'hash_mismatch'),
    errors: assets.filter((a) => a.status === 'error'),
    assets,
  };

  await writeFile(
    path.join(root, 'migration', 'assets.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
  console.log(
    `assets.json: ${out.downloaded}/${out.expectedCount}, unique=${out.uniqueSha256}, mismatches=${out.mismatches.length}, errors=${out.errors.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
