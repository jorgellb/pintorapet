#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, PRICE_CENTS } from './expected-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const API =
  'https://petsdrawings.com/wp-json/wc/store/v1/products?per_page=100&currency=EUR';

/** Stable UUID so local cart/quote can use migration IDs before Supabase import. */
function uuidFromLegacy(legacyId) {
  const bytes = Buffer.from(
    createHash('sha256')
      .update(`petsdrawings:product:v1:${legacyId}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const sourceDir = path.join(root, 'migration', 'source');
  await mkdir(sourceDir, { recursive: true });

  let apiProducts = [];
  let apiError = null;
  try {
    const res = await fetch(API, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PetsDrawingsMigration/1.0 (+local rebuild)',
      },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    apiProducts = await res.json();
    if (!Array.isArray(apiProducts)) {
      throw new Error('Store API did not return an array');
    }
    const stamp = fetchedAt.replace(/[:.]/g, '-');
    await writeFile(
      path.join(sourceDir, `wc-products-eur-${stamp}.json`),
      JSON.stringify({ fetchedAt, url: API, products: apiProducts }, null, 2),
    );
  } catch (err) {
    apiError = String(err?.message || err);
    console.warn('API fetch failed:', apiError);
    // Fall back to newest local snapshot so offline/sandbox runs still enrich prices.
    try {
      const { readdir } = await import('node:fs/promises');
      const files = (await readdir(sourceDir))
        .filter((f) => f.startsWith('wc-products-eur-') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files[0]) {
        const { readFile } = await import('node:fs/promises');
        const raw = JSON.parse(await readFile(path.join(sourceDir, files[0]), 'utf8'));
        apiProducts = Array.isArray(raw) ? raw : raw.products ?? [];
        console.warn(`Using local snapshot ${files[0]} (${apiProducts.length} products)`);
      }
    } catch (fallbackErr) {
      console.warn('No usable local snapshot:', fallbackErr.message);
    }
  }

  const byId = new Map(
    (Array.isArray(apiProducts) ? apiProducts : []).map((p) => [p.id, p]),
  );

  const priceNotes = [];
  const products = PRODUCTS.map((expected) => {
    const live = byId.get(expected.legacyId);
    const priceCents = PRICE_CENTS[expected.category];
    let liveCents = null;
    if (live?.prices) {
      const minor = Number(live.prices.currency_minor_unit ?? 2);
      const raw = live.prices.price ?? live.prices.regular_price;
      if (raw != null && live.prices.currency_code === 'EUR') {
        liveCents = Number(raw);
        if (minor !== 2) {
          priceNotes.push({
            legacyId: expected.legacyId,
            note: `unexpected minor unit ${minor}`,
          });
        }
        if (liveCents !== priceCents) {
          priceNotes.push({
            legacyId: expected.legacyId,
            auditCents: priceCents,
            liveCents,
          });
        }
      } else if (live) {
        priceNotes.push({
          legacyId: expected.legacyId,
          note: `currency ${live.prices?.currency_code}`,
        });
      }
    } else if (!apiError) {
      priceNotes.push({
        legacyId: expected.legacyId,
        note: 'missing from live API',
      });
    }

    return {
      id: uuidFromLegacy(expected.legacyId),
      legacyId: expected.legacyId,
      sku: `PD-${expected.legacyId}`,
      category: expected.category,
      motif: expected.motif,
      priceCents,
      currency: 'EUR',
      imageIds: expected.imageIds,
      slug: expected.slug,
      title: expected.title,
      summary: {
        en: `${expected.title.en} from Pets Drawings.`,
        es: `${expected.title.es} de Pets Drawings.`,
      },
      description: {
        en: 'Illustrated product from Meili’s pet portrait drawings.',
        es: 'Producto ilustrado a partir de los retratos de mascotas de Meili.',
      },
      sourcePath: expected.sourcePath,
      saleEnabled: false,
      inventoryMode: 'unverified',
      livePriceCents: liveCents,
    };
  });

  const out = {
    fetchedAt,
    sourceUrl: API,
    apiError,
    productCount: products.length,
    priceNotes,
    products,
  };

  await writeFile(
    path.join(root, 'migration', 'products.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
  console.log(
    `Wrote migration/products.json (${products.length} products)${apiError ? ` [API: ${apiError}]` : ''}`,
  );
  if (priceNotes.length) {
    console.log('Price notes:', priceNotes.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
