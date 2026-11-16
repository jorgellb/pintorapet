import { insertValues, json, setColumns, sql, type Db } from '@/lib/server/db';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';

import { variantTitle } from '@/lib/admin/slug';

type Translation = {
  locale: 'en' | 'es';
  slug: string;
  title: string;
  summary: string;
  description: string;
  seo_title: string | null;
  seo_description: string | null;
};

type Inventory = {
  stock_on_hand: number;
  stock_reserved: number;
  inventory_mode: 'tracked' | 'made_to_order' | 'unverified';
  verified_at: string | null;
  version: number;
};

export type AdminVariantRow = {
  id: string;
  sku: string;
  status: 'draft' | 'published' | 'archived';
  price_cents: number;
  sale_enabled: boolean;
  variant_label_en: string;
  variant_label_es: string;
  variant_order: number;
  inventory: Inventory | null;
};

const inventoryJson = sql`(
  select json_build_object('stock_on_hand', i.stock_on_hand, 'stock_reserved', i.stock_reserved,
                           'inventory_mode', i.inventory_mode, 'verified_at', i.verified_at, 'version', i.version)
  from public.inventory i where i.product_id = p.id)`;

export type AdminProductRow = {
  id: string;
  sku: string;
  motif: string;
  collection_id: string | null;
  status: 'draft' | 'published' | 'archived';
  price_cents: number;
  sale_enabled: boolean;
  price_version: number;
  weight_grams: number;
  updated_at: string;
  parent_id: string | null;
  variant_label_en: string;
  variant_label_es: string;
  variant_order: number;
  categories: { code: string } | null;
  product_translations: Translation[];
  inventory: Inventory | null;
};

/** Columns of the admin product list, with category, translations and stock nested as PostgREST did. */
const productSelect = sql`
  select p.id, p.sku, p.motif, p.collection_id, p.status, p.price_cents, p.sale_enabled, p.price_version,
         p.weight_grams, p.updated_at, p.parent_id, p.variant_label_en, p.variant_label_es, p.variant_order,
         (select json_build_object('code', c.code) from public.categories c where c.id = p.category_id) as categories,
         coalesce((
           select json_agg(json_build_object('locale', t.locale, 'slug', t.slug, 'title', t.title, 'summary', t.summary,
                                             'description', t.description, 'seo_title', t.seo_title,
                                             'seo_description', t.seo_description))
           from public.product_translations t where t.product_id = p.id), '[]'::json) as product_translations,
         ${inventoryJson} as inventory
  from public.products p`;

export async function listAdminProducts(client: Db): Promise<AdminProductRow[]> {
  return dbCall(() => client.rows<AdminProductRow>`${productSelect} order by p.editorial_order`);
}

export async function listVariants(client: Db, parentId: string): Promise<AdminVariantRow[]> {
  return dbCall(() => client.rows<AdminVariantRow>`
    select p.id, p.sku, p.status, p.price_cents, p.sale_enabled, p.variant_label_en, p.variant_label_es,
           p.variant_order, ${inventoryJson} as inventory
    from public.products p where p.parent_id = ${parentId} order by p.variant_order`);
}

export type ProductImageRow = {
  mediaAssetId: string;
  position: number;
  isCover: boolean;
  bucket: string;
  objectPath: string;
};

export async function listProductImages(client: Db, productId: string): Promise<ProductImageRow[]> {
  return dbCall(() => client.rows<ProductImageRow>`
    select i.media_asset_id as "mediaAssetId", i.position, i.is_cover as "isCover",
           m.bucket, m.object_path as "objectPath"
    from public.product_images i join public.media_assets m on m.id = i.media_asset_id
    where i.product_id = ${productId}
    order by i.is_cover desc, i.position`);
}

/** Replaces the photo set. The first id is the main photo; the rest keep their order. */
export async function setProductImages(client: Db, productId: string, mediaAssetIds: string[]): Promise<void> {
  const unique = [...new Set(mediaAssetIds)];
  await dbCall(async () => {
    await client.run`
      delete from public.product_images
      where product_id = ${productId} and not (media_asset_id = any(${unique}::uuid[]))`;
    if (unique.length === 0) return;
    await client.run`
      insert into public.product_images ${insertValues(
        unique.map((id, position) => ({ product_id: productId, media_asset_id: id, position, is_cover: position === 0 })),
      )}
      on conflict (product_id, media_asset_id) do update
        set position = excluded.position, is_cover = excluded.is_cover`;
  });
}

export type CreateProductInput = {
  parentId?: string | null;
  categoryCode?: string;
  motif?: string;
  sku: string;
  priceCents: number;
  status?: 'draft' | 'published' | 'archived';
  variantLabelEn?: string;
  variantLabelEs?: string;
  en: { title: string; slug: string; summary?: string; description?: string };
  es: { title: string; slug: string; summary?: string; description?: string };
};

/** Put a product in a shop category (Admin › Tienda › Categorías), or take it out with null. */
export async function setProductCollection(client: Db, id: string, collectionId: string | null): Promise<void> {
  await dbCall(() => client.run`update public.products set collection_id = ${collectionId} where id = ${id}`);
}

/**
 * The order of the pieces of one type (all the mugs…), as the shop shows them
 * when that type is picked. Options follow their product.
 */
export async function reorderProducts(client: Db, ids: string[]): Promise<void> {
  await dbCall(() => client.run`select public.admin_reorder_products(p_ids => ${ids}::uuid[])`);
}

export async function createAdminProduct(client: Db, input: CreateProductInput): Promise<string> {
  const row = await dbCall(() => client.one<{ id: string }>`select public.admin_create_product(p => ${json(input)}) as id`);
  return row!.id;
}

export async function deleteAdminProduct(client: Db, id: string): Promise<'deleted' | 'archived'> {
  const row = await dbCall(() =>
    client.one<{ result: 'deleted' | 'archived' }>`select public.admin_delete_product(p_product_id => ${id}) as result`,
  );
  return row!.result;
}

/** Variation titles follow the parent title plus their own label. */
export async function syncVariantTitles(client: Db, parentId: string): Promise<void> {
  await dbCall(async () => {
    const parent = await client.rows<{ locale: 'en' | 'es'; title: string }>`
      select locale, title from public.product_translations where product_id = ${parentId}`;
    const variants = await listVariants(client, parentId);
    for (const variant of variants) {
      for (const row of parent) {
        const label = row.locale === 'es' ? variant.variant_label_es : variant.variant_label_en;
        await client.run`
          update public.product_translations set title = ${variantTitle(row.title, label)}
          where product_id = ${variant.id} and locale = ${row.locale}`;
      }
    }
  });
}

export async function getAdminProduct(client: Db, id: string): Promise<AdminProductRow | null> {
  return dbCall(() => client.one<AdminProductRow>`${productSelect} where p.id = ${id}`);
}

export async function updateAdminProduct(
  client: Db,
  id: string,
  patch: {
    status?: 'draft' | 'published' | 'archived';
    priceCents?: number;
    saleEnabled?: boolean;
    weightGrams?: number;
    motif?: string;
    collectionId?: string | null;
    sku?: string;
    variantLabelEn?: string;
    variantLabelEs?: string;
    expectedUpdatedAt?: string;
    en?: TranslationPatch;
    es?: TranslationPatch;
  },
): Promise<void> {
  await dbCall(async () => {
    if (patch.expectedUpdatedAt) {
      const current = await client.one<{ updated_at: string }>`select updated_at from public.products where id = ${id}`;
      if (!current) {
        throw new CommerceError('UNAVAILABLE', 'Product not found', 404);
      }
      if (current.updated_at !== patch.expectedUpdatedAt) {
        throw new CommerceError('CONFLICT', 'Product was edited elsewhere — reload and try again', 409);
      }
    }

    const productPatch: Record<string, unknown> = {};
    if (patch.status) productPatch.status = patch.status;
    if (typeof patch.priceCents === 'number') {
      productPatch.price_cents = patch.priceCents;
      // Bump price version when price changes so open quotes invalidate.
      const current = await client.one<{ price_cents: number; price_version: number | null }>`
        select price_cents, price_version from public.products where id = ${id}`;
      if (current && current.price_cents !== patch.priceCents) {
        productPatch.price_version = (current.price_version ?? 1) + 1;
      }
    }
    if (typeof patch.saleEnabled === 'boolean') {
      productPatch.sale_enabled = patch.saleEnabled;
    }
    if (typeof patch.weightGrams === 'number') {
      productPatch.weight_grams = patch.weightGrams;
      await client.run`update public.products set weight_grams = ${patch.weightGrams} where parent_id = ${id}`;
    }
    if (patch.motif) productPatch.motif = patch.motif;
    if (patch.collectionId !== undefined) {
      productPatch.collection_id = patch.collectionId;
      // Variations belong to their product's shop category.
      await client.run`update public.products set collection_id = ${patch.collectionId} where parent_id = ${id}`;
    }
    if (patch.sku) productPatch.sku = patch.sku;
    if (patch.variantLabelEn !== undefined) productPatch.variant_label_en = patch.variantLabelEn;
    if (patch.variantLabelEs !== undefined) productPatch.variant_label_es = patch.variantLabelEs;

    if (Object.keys(productPatch).length > 0) {
      await client.run`update public.products set ${setColumns(productPatch)} where id = ${id}`;
    }

    for (const locale of ['en', 'es'] as const) {
      const loc = patch[locale];
      if (!loc) continue;
      const trPatch: Record<string, unknown> = {};
      if (loc.title !== undefined) trPatch.title = loc.title;
      if (loc.summary !== undefined) trPatch.summary = loc.summary;
      if (loc.description !== undefined) trPatch.description = loc.description;
      if (loc.slug !== undefined) trPatch.slug = loc.slug;
      if (loc.seoTitle !== undefined) trPatch.seo_title = loc.seoTitle.trim() || null;
      if (loc.seoDescription !== undefined) trPatch.seo_description = loc.seoDescription.trim() || null;
      if (Object.keys(trPatch).length === 0) continue;
      await client.run`
        update public.product_translations set ${setColumns(trPatch)}
        where product_id = ${id} and locale = ${locale}`;
    }

    const row = await client.one<{ parent_id: string | null }>`select parent_id from public.products where id = ${id}`;
    await syncVariantTitles(client, row?.parent_id ?? id);
  });
}

type TranslationPatch = {
  title?: string;
  summary?: string;
  description?: string;
  slug?: string;
  seoTitle?: string;
  seoDescription?: string;
};

export async function adjustProductInventory(
  client: Db,
  opts: {
    productId: string;
    stockOnHand: number;
    inventoryMode: 'tracked' | 'made_to_order' | 'unverified';
    adminUserId: string;
    note?: string;
  },
) {
  return dbCall(() => client.one`
    select * from public.adjust_inventory(
      p_product_id => ${opts.productId}, p_stock_on_hand => ${opts.stockOnHand},
      p_inventory_mode => ${opts.inventoryMode}::public.inventory_mode, p_admin_user_id => ${opts.adminUserId},
      p_note => ${opts.note ?? null})`);
}
