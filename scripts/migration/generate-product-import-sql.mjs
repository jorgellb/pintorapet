#!/usr/bin/env node
/**
 * Emit SQL INSERT statements for products + translations from migration/products.json.
 * Matches supabase/migrations/20261021000000_init.sql column names.
 * Does not invent stock quantities. sale_enabled stays false; inventory unverified.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const doc = JSON.parse(await readFile(path.join(root, 'migration', 'products.json'), 'utf8'));
  const lines = [
    '-- Generated from migration/products.json — review before applying',
    '-- Requires categories seeded (greeting-cards, coasters, mugs)',
    '-- Inventory remains unverified; sale_enabled = false',
    'BEGIN;',
    '',
  ];

  for (const p of doc.products) {
    lines.push(`-- ${p.title.en} (legacy ${p.legacyId})`);
    lines.push(`INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  ${sqlStr(p.id)}::uuid,
  ${p.legacyId},
  ${sqlStr(p.sku)},
  (SELECT id FROM public.categories WHERE code = ${sqlStr(p.category)}),
  ${sqlStr(p.motif)},
  'published',
  ${p.priceCents},
  'EUR',
  false,
  ${p.legacyId}
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();`);
    lines.push(`INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES (${sqlStr(p.id)}::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;`);
    for (const locale of ['en', 'es']) {
      lines.push(`INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  ${sqlStr(p.id)}::uuid,
  '${locale}',
  ${sqlStr(p.slug[locale])},
  ${sqlStr(p.title[locale])},
  ${sqlStr(p.summary?.[locale] ?? '')},
  ${sqlStr(p.description?.[locale] ?? '')}
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();`);
    }
    lines.push('');
  }

  lines.push('COMMIT;');
  const outDir = path.join(root, 'supabase', 'seed');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'products_from_migration.sql');
  await writeFile(outPath, lines.join('\n') + '\n');
  console.log(`Wrote ${outPath} (${doc.products.length} products)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
