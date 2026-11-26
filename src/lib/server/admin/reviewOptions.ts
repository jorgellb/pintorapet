import { sql, type Db } from '@/lib/server/db';

/** What Meili can tie her own review to: a product, or a commission (neither means "en general"). */

export type ReviewChoice = { id: string; name: string };

export type ReviewOptions = { products: ReviewChoice[]; commissions: ReviewChoice[] };

type ProductRow = { id: string; title: string | null; sku: string; parent_id: string | null; variant_label_es: string; parent_title: string | null };

const PRODUCT_NAME = sql`
  select p.id, p.sku, p.parent_id, p.variant_label_es,
         (select t.title from public.product_translations t where t.product_id = p.id and t.locale = 'es') as title,
         (select t.title from public.product_translations t where t.product_id = p.parent_id and t.locale = 'es') as parent_title
  from public.products p`;

/** «Producto», or «Producto — opción» for one option of a product. */
const productName = (p: ProductRow) => {
  const base = p.parent_title ?? p.title ?? p.sku;
  return p.parent_id && p.variant_label_es ? `${base} — ${p.variant_label_es}` : base;
};

/** The name of one product, as the selects show it (null if it is gone). */
export async function productLabel(db: Db, id: string): Promise<string | null> {
  const row = await db.one<ProductRow>(sql`${PRODUCT_NAME} where p.id = ${id}`);
  return row ? productName(row) : null;
}

export async function reviewOptions(db: Db): Promise<ReviewOptions> {
  const [products, commissions] = await Promise.all([
    db.rows<ProductRow>(sql`${PRODUCT_NAME} where p.status <> 'archived'`),
    db.rows<{ id: string; reference: string; contact_name: string; created_at: string }>`
      select id, reference, contact_name, created_at from public.commission_requests order by created_at desc limit 200`,
  ]);
  return {
    products: products.map((p) => ({ id: p.id, name: productName(p) })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    commissions: commissions.map((c) => ({
      id: c.id,
      name: `${c.reference} · ${c.contact_name} · ${new Date(c.created_at).toLocaleDateString('es-ES')}`,
    })),
  };
}
