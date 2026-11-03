import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { storagePublicUrl } from '@/lib/server/storageUrl';

/**
 * Shop categories (Admin › Tienda › Categorías, table shop_collections): the
 * portraits the shop is arranged by. Not the product type (card, coaster,
 * mug), which lives in public.categories and sets VAT and shipping weight.
 */

export const shopCategorySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'CODE'),
    nameEs: z.string().trim().min(1).max(80),
    nameEn: z.string().trim().min(1).max(80),
    descriptionEs: z.string().trim().max(400).default(''),
    descriptionEn: z.string().trim().max(400).default(''),
    portraitMediaId: z.uuid().nullable().default(null),
    published: z.boolean().default(true),
  })
  .strict();

export type ShopCategoryInput = z.infer<typeof shopCategorySchema>;

export type ShopCategoryRow = {
  id: string;
  code: string;
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
  portraitMediaId: string | null;
  portraitUrl: string | null;
  sortOrder: number;
  published: boolean;
  productCount: number;
};

type DbRow = {
  id: string;
  code: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  portrait_media_id: string | null;
  sort_order: number;
  published: boolean;
  media_assets: { bucket: string; object_path: string } | null;
  products: Array<{ count: number }>;
};

const SELECT =
  'id, code, name_es, name_en, description_es, description_en, portrait_media_id, sort_order, published, media_assets(bucket, object_path), products(count)';

const fromDb = (row: DbRow): ShopCategoryRow => ({
  id: row.id,
  code: row.code,
  nameEs: row.name_es,
  nameEn: row.name_en,
  descriptionEs: row.description_es,
  descriptionEn: row.description_en,
  portraitMediaId: row.portrait_media_id,
  portraitUrl: row.media_assets ? storagePublicUrl(row.media_assets.bucket, row.media_assets.object_path) : null,
  sortOrder: row.sort_order,
  published: row.published,
  productCount: row.products?.[0]?.count ?? 0,
});

const toDb = (input: ShopCategoryInput) => ({
  code: input.code,
  name_es: input.nameEs,
  name_en: input.nameEn,
  description_es: input.descriptionEs,
  description_en: input.descriptionEn,
  portrait_media_id: input.portraitMediaId,
  published: input.published,
});

export async function listShopCategories(client: SupabaseClient): Promise<ShopCategoryRow[]> {
  const { data, error } = await client.from('shop_collections').select(SELECT).order('sort_order').order('name_es');
  if (error) throw mapPgError(error);
  return ((data ?? []) as unknown as DbRow[]).map(fromDb);
}

export async function getShopCategory(client: SupabaseClient, id: string): Promise<ShopCategoryRow | null> {
  const { data, error } = await client.from('shop_collections').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw mapPgError(error);
  return data ? fromDb(data as unknown as DbRow) : null;
}

/** New categories go to the end of the shop. */
export async function createShopCategory(client: SupabaseClient, input: ShopCategoryInput): Promise<string> {
  const { data: last } = await client
    .from('shop_collections')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await client
    .from('shop_collections')
    .insert({ ...toDb(input), sort_order: (last?.sort_order ?? 0) + 10 })
    .select('id')
    .single();
  if (error) throw mapPgError(error);
  return data.id as string;
}

export async function updateShopCategory(client: SupabaseClient, id: string, input: ShopCategoryInput): Promise<void> {
  const { data, error } = await client.from('shop_collections').update(toDb(input)).eq('id', id).select('id');
  if (error) throw mapPgError(error);
  if (!data?.length) throw new CommerceError('UNAVAILABLE', 'Esa categoría ya no existe.', 404);
}

/** Its products stay in the shop, without a category. */
export async function deleteShopCategory(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('shop_collections').delete().eq('id', id).select('id');
  if (error) throw mapPgError(error);
  if (!data?.length) throw new CommerceError('UNAVAILABLE', 'Esa categoría ya no existe.', 404);
}

/** The shop shows categories in this order. */
export async function reorderShopCategories(client: SupabaseClient, ids: string[]): Promise<void> {
  const { error } = await client.rpc('admin_reorder_shop_collections', { p_ids: ids });
  if (error) throw mapPgError(error);
}
