import { z } from 'zod';
import { insertValues, setColumns, type Db } from '@/lib/server/db';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { TYPE_ICONS } from '@/lib/catalog/productTypes';

/**
 * Product types (Admin › Tienda › Tipos de producto, table categories): cards,
 * coasters, mugs… Each one names its pieces in the shop, orders the shop's
 * filters, and gives new products their weight and VAT. Not the shop
 * categories (portraits), which live in shop_collections.
 */

const name = z.string().trim().min(1).max(60);

export const productTypeSchema = z
  .object({
    nameEs: name,
    nameEn: name,
    singularEs: name,
    singularEn: name,
    phraseEs: z.string().trim().max(60).default(''),
    phraseEn: z.string().trim().max(60).default(''),
    icon: z.enum(TYPE_ICONS),
    defaultWeightGrams: z.number().int().min(1).max(30000),
    vatRate: z.union([z.literal(0), z.literal(4), z.literal(10), z.literal(21)]),
    googleCategory: z.string().trim().max(250).default(''),
    published: z.boolean().default(true),
  })
  .strict();

/** A new type also needs its address, which cannot change afterwards. */
export const newProductTypeSchema = productTypeSchema.extend({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'CODE'),
});

export type ProductTypeInput = z.infer<typeof productTypeSchema>;
export type NewProductTypeInput = z.infer<typeof newProductTypeSchema>;

export type AdminProductType = ProductTypeInput & {
  id: string;
  code: string;
  sortOrder: number;
  productCount: number;
};

type DbRow = {
  id: string;
  code: string;
  name_es: string;
  name_en: string;
  singular_es: string;
  singular_en: string;
  phrase_es: string;
  phrase_en: string;
  icon: string;
  default_weight_grams: number;
  vat_rate: number | string;
  google_category: string;
  published: boolean;
  sort_order: number;
};


const fromDb = (row: DbRow, productCount: number): AdminProductType => ({
  id: row.id,
  code: row.code,
  nameEs: row.name_es,
  nameEn: row.name_en,
  singularEs: row.singular_es,
  singularEn: row.singular_en,
  phraseEs: row.phrase_es,
  phraseEn: row.phrase_en,
  icon: (TYPE_ICONS as readonly string[]).includes(row.icon) ? (row.icon as AdminProductType['icon']) : 'tag',
  defaultWeightGrams: row.default_weight_grams,
  vatRate: Number(row.vat_rate) as AdminProductType['vatRate'],
  googleCategory: row.google_category,
  published: row.published,
  sortOrder: row.sort_order,
  productCount,
});

/** Products per type (id → count), options left out: Llaveros has 9, not 18. */
async function productCounts(client: Db): Promise<Map<string, number>> {
  const rows = await dbCall(() => client.rows<{ category_id: string; n: number }>`
    select category_id, count(*) as n from public.products where parent_id is null group by category_id`);
  return new Map(rows.map((row) => [String(row.category_id), row.n]));
}

const toDb = (input: ProductTypeInput) => ({
  name_es: input.nameEs,
  name_en: input.nameEn,
  singular_es: input.singularEs,
  singular_en: input.singularEn,
  phrase_es: input.phraseEs,
  phrase_en: input.phraseEn,
  icon: input.icon,
  default_weight_grams: input.defaultWeightGrams,
  vat_rate: input.vatRate,
  google_category: input.googleCategory,
  published: input.published,
});

/** Every type, hidden ones too, in the shop's order. */
export async function listProductTypes(client: Db): Promise<AdminProductType[]> {
  const [rows, counts] = await Promise.all([
    dbCall(() => client.rows<DbRow>`select * from public.categories order by sort_order, name_es`),
    productCounts(client),
  ]);
  return rows.map((row) => fromDb(row, counts.get(row.id) ?? 0));
}

/** code → Spanish plural ("mugs" → "Tazas"), in the shop's order: for the admin's lists and tabs. */
export async function productTypeNames(client: Db): Promise<Map<string, string>> {
  const rows = await client
    .rows<{ code: string; name_es: string }>`select code, name_es from public.categories order by sort_order`
    .catch(() => []);
  return new Map(rows.map((row) => [String(row.code), String(row.name_es)]));
}

export async function getProductType(client: Db, id: string): Promise<AdminProductType | null> {
  const [row, counts] = await Promise.all([
    dbCall(() => client.one<DbRow>`select * from public.categories where id = ${id}`),
    productCounts(client),
  ]);
  return row ? fromDb(row, counts.get(id) ?? 0) : null;
}

/** New types go to the end of the shop's filters. */
export async function createProductType(client: Db, input: NewProductTypeInput): Promise<string> {
  const { code, ...rest } = input;
  const row = await dbCall(async () => {
    const last = await client.one<{ sort_order: number }>`
      select sort_order from public.categories order by sort_order desc limit 1`;
    return client.one<{ id: string }>`
      insert into public.categories ${insertValues({
        ...toDb(rest),
        code,
        slug_es: code,
        slug_en: code,
        sort_order: (last?.sort_order ?? 0) + 10,
      })}
      returning id`;
  });
  return row!.id;
}

export async function updateProductType(client: Db, id: string, input: ProductTypeInput): Promise<void> {
  const changed = await dbCall(() => client.run`update public.categories set ${setColumns(toDb(input))} where id = ${id}`);
  if (!changed) throw new CommerceError('UNAVAILABLE', 'Ese tipo de producto ya no existe.', 404);
}

/** Only a type without products: their VAT and weight come from it. */
export async function deleteProductType(client: Db, id: string): Promise<void> {
  const count = (
    await dbCall(() => client.one<{ n: number }>`
      select count(*) as n from public.products where category_id = ${id} and parent_id is null`)
  )?.n;
  if (count) {
    throw new CommerceError(
      'CONFLICT',
      `Este tipo tiene ${count} ${count === 1 ? 'producto' : 'productos'}. Bórralos o, si solo quieres quitarlo de la tienda, ocúltalo.`,
      409,
    );
  }
  const deleted = await dbCall(() => client.run`delete from public.categories where id = ${id}`);
  if (!deleted) throw new CommerceError('UNAVAILABLE', 'Ese tipo de producto ya no existe.', 404);
}

/** The shop shows its filters, and each portrait's pieces, in this order. */
export async function reorderProductTypes(client: Db, ids: string[]): Promise<void> {
  await dbCall(() => client.run`select public.admin_reorder_product_types(p_ids => ${ids}::uuid[])`);
}
