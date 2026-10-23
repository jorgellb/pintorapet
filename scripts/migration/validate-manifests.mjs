#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_HASHES, PRODUCTS, PRICE_CENTS } from './expected-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(root, rel), 'utf8'));
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

async function main() {
  const productsDoc = await readJson('migration/products.json');
  const products = productsDoc.products ?? [];
  if (products.length !== 18) fail(`expected 18 products, got ${products.length}`);
  if (PRODUCTS.length !== 18) fail('expected catalog size');

  const seenImagePairs = new Set();
  const allImageIds = [];
  for (const p of products) {
    if (!PRICE_CENTS[p.category] || p.priceCents !== PRICE_CENTS[p.category]) {
      fail(`bad price for ${p.legacyId}: ${p.priceCents}`);
    }
    if (![349, 499, 999].includes(p.priceCents)) {
      fail(`priceCents not in EUR audit set for ${p.legacyId}: ${p.priceCents}`);
    }
    if (p.currency !== 'EUR') fail(`currency ${p.legacyId}`);
    const uniq = [...new Set(p.imageIds)];
    if (uniq.length !== p.imageIds.length) {
      fail(`duplicate images on product ${p.legacyId}`);
    }
    for (const img of p.imageIds) {
      const key = `${p.legacyId}:${img}`;
      if (seenImagePairs.has(key)) fail(`dup assoc ${key}`);
      seenImagePairs.add(key);
      allImageIds.push(img);
    }
  }
  if (allImageIds.length !== 47) {
    fail(`expected 47 image associations after normalize, got ${allImageIds.length}`);
  }
  if (new Set(allImageIds).size !== 47) {
    fail(`expected 47 unique image IDs, got ${new Set(allImageIds).size}`);
  }

  let assetsDoc;
  try {
    assetsDoc = await readJson('migration/assets.json');
  } catch {
    console.warn('WARN: migration/assets.json missing — run fetch-assets');
    return;
  }

  const expectedIds = Object.keys(ASSET_HASHES).map(Number).sort((a, b) => a - b);
  if (expectedIds.length !== 47) fail(`expected 47 asset defs, got ${expectedIds.length}`);
  if (assetsDoc.uniqueSha256 && assetsDoc.uniqueSha256 !== 47) {
    fail(`expected 47 unique hashes, got ${assetsDoc.uniqueSha256}`);
  }
  if (assetsDoc.mismatches?.length) {
    fail(`hash mismatches: ${assetsDoc.mismatches.length}`);
  }
  if (assetsDoc.errors?.length) {
    fail(`download errors: ${assetsDoc.errors.length}`);
  }

  console.log('OK: products=18, assets validated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
