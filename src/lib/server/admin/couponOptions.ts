import type { Db } from '@/lib/server/db';

/** What Admin › Cupones offers to choose from: the shop's types, categories, products and shipping zones. */

export type CouponChoice = { id: string; name: string };
/** A product to pick. A product with options is picked as all its options (`ids`). */
export type ProductChoice = { id: string; name: string; sub: string; ids: string[] };

export type CouponOptions = {
  categories: CouponChoice[];
  collections: CouponChoice[];
  products: CouponChoice[];
  /** What the picker lists: each option, and each product with options as one entry for all of them. */
  productChoices: ProductChoice[];
  zones: CouponChoice[];
};

type ProductRow = {
  id: string;
  sku: string;
  parent_id: string | null;
  variant_label_es: string;
  status: string;
  title: string | null;
  parent_title: string | null;
};

export async function couponOptions(db: Db): Promise<CouponOptions> {
  const [categories, collections, zones, products] = await Promise.all([
    db.rows<{ id: string; name_es: string }>`select id, name_es from public.categories order by sort_order, name_es`,
    db.rows<{ id: string; name_es: string }>`select id, name_es from public.shop_collections order by sort_order, name_es`,
    db.rows<{ id: string; name_es: string }>`select id, name_es from public.shipping_zones order by position`,
    db.rows<ProductRow>`
      select p.id, p.sku, p.parent_id, p.variant_label_es, p.status::text as status,
             (select t.title from public.product_translations t where t.product_id = p.id and t.locale = 'es') as title,
             (select t.title from public.product_translations t where t.product_id = p.parent_id and t.locale = 'es') as parent_title
      from public.products p`,
  ]);

  const nameOf = (row: ProductRow) => {
    const base = row.parent_title ?? row.title ?? row.sku;
    return row.parent_id && row.variant_label_es ? `${base} — ${row.variant_label_es}` : base;
  };
  const parentsWithOptions = new Set(products.flatMap((p) => (p.parent_id ? [p.parent_id] : [])));

  const named = products
    .map((p) => ({ id: p.id, name: nameOf(p), sub: p.status === 'published' ? '' : p.status === 'archived' ? 'archivado' : 'borrador', row: p }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const choices: ProductChoice[] = [];
  for (const p of named) {
    // The parent of options is not sold itself: its options are.
    if (parentsWithOptions.has(p.id)) {
      const options = named.filter((o) => o.row.parent_id === p.id);
      choices.push({ id: p.id, name: `${p.name} (todas las opciones)`, sub: p.sub, ids: options.map((o) => o.id) });
    } else {
      choices.push({ id: p.id, name: p.name, sub: p.sub, ids: [p.id] });
    }
  }

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name_es })),
    collections: collections.map((c) => ({ id: c.id, name: c.name_es })),
    zones: zones.map((z) => ({ id: z.id, name: z.name_es })),
    // Names for the summary (and for chips): every product, parents of options included.
    products: named.map((p) => ({ id: p.id, name: p.name })),
    productChoices: choices,
  };
}
