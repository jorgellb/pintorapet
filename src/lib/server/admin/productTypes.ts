import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
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

const SELECT =
  'id, code, name_es, name_en, singular_es, singular_en, phrase_es, phrase_en, icon, default_weight_grams, vat_rate, google_category, published, sort_order';

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
async function productCounts(client: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await client.from('products').select('category_id').is('parent_id', null);
  if (error) throw mapPgError(error);
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(String(row.category_id), (counts.get(String(row.category_id)) ?? 0) + 1);
  return counts;
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
export async function listProductTypes(client: SupabaseClient): Promise<AdminProductType[]> {
  const [{ data, error }, counts] = await Promise.all([
    client.from('categories').select(SELECT).order('sort_order').order('name_es'),
    productCounts(client),
  ]);
  if (error) throw mapPgError(error);
  return ((data ?? []) as unknown as DbRow[]).map((row) => fromDb(row, counts.get(row.id) ?? 0));
}

/** code → Spanish plural ("mugs" → "Tazas"), in the shop's order: for the admin's lists and tabs. */
export async function productTypeNames(client: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await client.from('categories').select('code, name_es').order('sort_order');
  return new Map((data ?? []).map((row) => [String(row.code), String(row.name_es)]));
}

export async function getProductType(client: SupabaseClient, id: string): Promise<AdminProductType | null> {
  const [{ data, error }, counts] = await Promise.all([
    client.from('categories').select(SELECT).eq('id', id).maybeSingle(),
    productCounts(client),
  ]);
  if (error) throw mapPgError(error);
  return data ? fromDb(data as unknown as DbRow, counts.get(id) ?? 0) : null;
}

/** New types go to the end of the shop's filters. */
export async function createProductType(client: SupabaseClient, input: NewProductTypeInput): Promise<string> {
  const { data: last } = await client
    .from('categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { code, ...rest } = input;
  const { data, error } = await client
    .from('categories')
    .insert({ ...toDb(rest), code, slug_es: code, slug_en: code, sort_order: (last?.sort_order ?? 0) + 10 })
    .select('id')
    .single();
  if (error) throw mapPgError(error);
  return data.id as string;
}

export async function updateProductType(client: SupabaseClient, id: string, input: ProductTypeInput): Promise<void> {
  const { data, error } = await client.from('categories').update(toDb(input)).eq('id', id).select('id');
  if (error) throw mapPgError(error);
  if (!data?.length) throw new CommerceError('UNAVAILABLE', 'Ese tipo de producto ya no existe.', 404);
}

/** Only a type without products: their VAT and weight come from it. */
export async function deleteProductType(client: SupabaseClient, id: string): Promise<void> {
  const { count } = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)
    .is('parent_id', null);
  if (count) {
    throw new CommerceError(
      'CONFLICT',
      `Este tipo tiene ${count} ${count === 1 ? 'producto' : 'productos'}. Bórralos o, si solo quieres quitarlo de la tienda, ocúltalo.`,
      409,
    );
  }
  const { data, error } = await client.from('categories').delete().eq('id', id).select('id');
  if (error) throw mapPgError(error);
  if (!data?.length) throw new CommerceError('UNAVAILABLE', 'Ese tipo de producto ya no existe.', 404);
}

/** The shop shows its filters, and each portrait's pieces, in this order. */
export async function reorderProductTypes(client: SupabaseClient, ids: string[]): Promise<void> {
  const { error } = await client.rpc('admin_reorder_product_types', { p_ids: ids });
  if (error) throw mapPgError(error);
}
