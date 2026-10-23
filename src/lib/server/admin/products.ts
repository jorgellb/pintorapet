import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';

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

export type AdminProductRow = {
  id: string;
  sku: string;
  motif: string;
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

const productColumns = `
  id, sku, motif, status, price_cents, sale_enabled, price_version, weight_grams, updated_at,
  parent_id, variant_label_en, variant_label_es, variant_order, categories ( code ),
  product_translations ( locale, slug, title, summary, description, seo_title, seo_description ),
  inventory ( stock_on_hand, stock_reserved, inventory_mode, verified_at, version )
`;

export async function listAdminProducts(
  client: SupabaseClient,
): Promise<AdminProductRow[]> {
  const { data, error } = await client
    .from('products')
    .select(productColumns)
    .order('editorial_order', { ascending: true });

  if (error) throw mapPgError(error);
  return (data ?? []) as unknown as AdminProductRow[];
}

export async function listVariants(
  client: SupabaseClient,
  parentId: string,
): Promise<AdminVariantRow[]> {
  const { data, error } = await client
    .from('products')
    .select(
      'id, sku, status, price_cents, sale_enabled, variant_label_en, variant_label_es, variant_order, inventory ( stock_on_hand, stock_reserved, inventory_mode, verified_at, version )',
    )
    .eq('parent_id', parentId)
    .order('variant_order');
  if (error) throw mapPgError(error);
  return (data ?? []) as unknown as AdminVariantRow[];
}

export type ProductImageRow = {
  mediaAssetId: string;
  position: number;
  isCover: boolean;
  bucket: string;
  objectPath: string;
};

export async function listProductImages(
  client: SupabaseClient,
  productId: string,
): Promise<ProductImageRow[]> {
  const { data, error } = await client
    .from('product_images')
    .select('media_asset_id, position, is_cover, media_assets ( bucket, object_path )')
    .eq('product_id', productId)
    .order('position');
  if (error) throw mapPgError(error);
  type Raw = {
    media_asset_id: string;
    position: number;
    is_cover: boolean;
    media_assets: { bucket: string; object_path: string } | null;
  };
  return ((data ?? []) as unknown as Raw[])
    .filter((row) => row.media_assets)
    .map((row) => ({
      mediaAssetId: row.media_asset_id,
      position: row.position,
      isCover: row.is_cover,
      bucket: row.media_assets!.bucket,
      objectPath: row.media_assets!.object_path,
    }))
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position);
}

/** Replaces the photo set. The first id is the main photo; the rest keep their order. */
export async function setProductImages(
  client: SupabaseClient,
  productId: string,
  mediaAssetIds: string[],
): Promise<void> {
  const unique = [...new Set(mediaAssetIds)];
  const current = await client.from('product_images').select('media_asset_id').eq('product_id', productId);
  if (current.error) throw mapPgError(current.error);
  const stale = (current.data ?? [])
    .map((row) => row.media_asset_id as string)
    .filter((id) => !unique.includes(id));
  if (stale.length > 0) {
    const removed = await client
      .from('product_images')
      .delete()
      .eq('product_id', productId)
      .in('media_asset_id', stale);
    if (removed.error) throw mapPgError(removed.error);
  }
  if (unique.length === 0) return;
  const { error } = await client.from('product_images').upsert(
    unique.map((id, position) => ({
      product_id: productId,
      media_asset_id: id,
      position,
      is_cover: position === 0,
    })),
    { onConflict: 'product_id,media_asset_id' },
  );
  if (error) throw mapPgError(error);
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

export async function createAdminProduct(
  client: SupabaseClient,
  input: CreateProductInput,
): Promise<string> {
  const { data, error } = await client.rpc('admin_create_product', { p: input });
  if (error) throw mapPgError(error);
  return data as string;
}

export async function deleteAdminProduct(
  client: SupabaseClient,
  id: string,
): Promise<'deleted' | 'archived'> {
  const { data, error } = await client.rpc('admin_delete_product', { p_product_id: id });
  if (error) throw mapPgError(error);
  return data as 'deleted' | 'archived';
}

/** Variation titles follow the parent title plus their own label. */
export async function syncVariantTitles(client: SupabaseClient, parentId: string): Promise<void> {
  const { data: parent, error } = await client
    .from('product_translations')
    .select('locale, title')
    .eq('product_id', parentId);
  if (error) throw mapPgError(error);
  const variants = await listVariants(client, parentId);
  for (const variant of variants) {
    for (const row of parent ?? []) {
      const label = row.locale === 'es' ? variant.variant_label_es : variant.variant_label_en;
      const { error: updateError } = await client
        .from('product_translations')
        .update({ title: variantTitle(row.title as string, label) })
        .eq('product_id', variant.id)
        .eq('locale', row.locale);
      if (updateError) throw mapPgError(updateError);
    }
  }
}

export async function getAdminProduct(
  client: SupabaseClient,
  id: string,
): Promise<AdminProductRow | null> {
  const { data, error } = await client
    .from('products')
    .select(productColumns)
    .eq('id', id)
    .maybeSingle();

  if (error) throw mapPgError(error);
  return (data as unknown as AdminProductRow) ?? null;
}

export async function updateAdminProduct(
  client: SupabaseClient,
  id: string,
  patch: {
    status?: 'draft' | 'published' | 'archived';
    priceCents?: number;
    saleEnabled?: boolean;
    weightGrams?: number;
    motif?: string;
    sku?: string;
    variantLabelEn?: string;
    variantLabelEs?: string;
    expectedUpdatedAt?: string;
    en?: TranslationPatch;
    es?: TranslationPatch;
  },
): Promise<void> {
  if (patch.expectedUpdatedAt) {
    const { data: current, error: curErr } = await client
      .from('products')
      .select('updated_at')
      .eq('id', id)
      .maybeSingle();
    if (curErr) throw mapPgError(curErr);
    if (!current) {
      throw new CommerceError('UNAVAILABLE', 'Product not found', 404);
    }
    if (current.updated_at !== patch.expectedUpdatedAt) {
      throw new CommerceError(
        'CONFLICT',
        'Product was edited elsewhere — reload and try again',
        409,
      );
    }
  }

  const productPatch: Record<string, unknown> = {};
  if (patch.status) productPatch.status = patch.status;
  if (typeof patch.priceCents === 'number') {
    productPatch.price_cents = patch.priceCents;
    // Bump price version when price changes so open quotes invalidate.
    const { data: current } = await client
      .from('products')
      .select('price_cents, price_version')
      .eq('id', id)
      .maybeSingle();
    if (current && current.price_cents !== patch.priceCents) {
      productPatch.price_version = (current.price_version ?? 1) + 1;
    }
  }
  if (typeof patch.saleEnabled === 'boolean') {
    productPatch.sale_enabled = patch.saleEnabled;
  }
  if (typeof patch.weightGrams === 'number') {
    productPatch.weight_grams = patch.weightGrams;
    const { error: variantsErr } = await client
      .from('products')
      .update({ weight_grams: patch.weightGrams })
      .eq('parent_id', id);
    if (variantsErr) throw mapPgError(variantsErr);
  }
  if (patch.motif) productPatch.motif = patch.motif;
  if (patch.sku) productPatch.sku = patch.sku;
  if (patch.variantLabelEn !== undefined) productPatch.variant_label_en = patch.variantLabelEn;
  if (patch.variantLabelEs !== undefined) productPatch.variant_label_es = patch.variantLabelEs;

  if (Object.keys(productPatch).length > 0) {
    const { error } = await client.from('products').update(productPatch).eq('id', id);
    if (error) throw mapPgError(error);
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
    const { error } = await client
      .from('product_translations')
      .update(trPatch)
      .eq('product_id', id)
      .eq('locale', locale);
    if (error) throw mapPgError(error);
  }

  const { data: row } = await client.from('products').select('parent_id').eq('id', id).maybeSingle();
  await syncVariantTitles(client, (row?.parent_id as string | null) ?? id);
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
  client: SupabaseClient,
  opts: {
    productId: string;
    stockOnHand: number;
    inventoryMode: 'tracked' | 'made_to_order' | 'unverified';
    adminUserId: string;
    note?: string;
  },
) {
  const { data, error } = await client.rpc('adjust_inventory', {
    p_product_id: opts.productId,
    p_stock_on_hand: opts.stockOnHand,
    p_inventory_mode: opts.inventoryMode,
    p_admin_user_id: opts.adminUserId,
    p_note: opts.note ?? null,
  });
  if (error) throw mapPgError(error);
  return data;
}
