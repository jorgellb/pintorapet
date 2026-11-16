import { z } from 'zod';
import { insertValues, setColumns, sql, type Db } from '@/lib/server/db';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
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

/** The portrait's file and the number of products (options included), nested as PostgREST did. */
const SELECT = sql`
  select c.id, c.code, c.name_es, c.name_en, c.description_es, c.description_en, c.portrait_media_id, c.sort_order,
         c.published,
         (select json_build_object('bucket', m.bucket, 'object_path', m.object_path)
          from public.media_assets m where m.id = c.portrait_media_id) as media_assets,
         json_build_array(json_build_object('count', (select count(*) from public.products p where p.collection_id = c.id))) as products
  from public.shop_collections c`;

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

export async function listShopCategories(client: Db): Promise<ShopCategoryRow[]> {
  const rows = await dbCall(() => client.rows<DbRow>`${SELECT} order by c.sort_order, c.name_es`);
  return rows.map(fromDb);
}

export async function getShopCategory(client: Db, id: string): Promise<ShopCategoryRow | null> {
  const row = await dbCall(() => client.one<DbRow>`${SELECT} where c.id = ${id}`);
  return row ? fromDb(row) : null;
}

/** New categories go to the end of the shop. */
export async function createShopCategory(client: Db, input: ShopCategoryInput): Promise<string> {
  const row = await dbCall(async () => {
    const last = await client.one<{ sort_order: number }>`
      select sort_order from public.shop_collections order by sort_order desc limit 1`;
    return client.one<{ id: string }>`
      insert into public.shop_collections ${insertValues({ ...toDb(input), sort_order: (last?.sort_order ?? 0) + 10 })}
      returning id`;
  });
  return row!.id;
}

export async function updateShopCategory(client: Db, id: string, input: ShopCategoryInput): Promise<void> {
  const changed = await dbCall(() => client.run`update public.shop_collections set ${setColumns(toDb(input))} where id = ${id}`);
  if (!changed) throw new CommerceError('UNAVAILABLE', 'Esa categoría ya no existe.', 404);
}

/** Its products stay in the shop, without a category. */
export async function deleteShopCategory(client: Db, id: string): Promise<void> {
  const deleted = await dbCall(() => client.run`delete from public.shop_collections where id = ${id}`);
  if (!deleted) throw new CommerceError('UNAVAILABLE', 'Esa categoría ya no existe.', 404);
}

/** The shop shows categories in this order. */
export async function reorderShopCategories(client: Db, ids: string[]): Promise<void> {
  await dbCall(() => client.run`select public.admin_reorder_shop_collections(p_ids => ${ids}::uuid[])`);
}
