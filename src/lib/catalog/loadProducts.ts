import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locale } from '@/i18n/routes';
import type { ProductPublic } from '@/lib/domain/types';
import { hasSupabase } from '@/lib/server/env';
import { storagePublicUrl } from '@/lib/server/storageUrl';

export type CatalogSource = 'supabase' | 'migration' | 'empty';

export interface ManifestProduct {
  id?: string;
  legacyId: number;
  sku: string;
  category: ProductPublic['category'];
  motif: string;
  priceCents: number;
  currency: 'EUR';
  imageIds?: number[];
  slug: { en: string; es: string };
  title: { en: string; es: string };
  summary?: { en: string; es: string };
  description?: { en: string; es: string };
  saleEnabled?: boolean;
  status?: ProductPublic['status'];
  inventoryMode?: ProductPublic['inventoryMode'];
  availability?: ProductPublic['availability'];
}

type MediaPublicIndex = Map<number, string>;

async function loadMediaPublicIndex(): Promise<MediaPublicIndex> {
  const map: MediaPublicIndex = new Map();
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'migration', 'media-public.json'),
      'utf8',
    );
    const doc = JSON.parse(raw) as {
      assets?: Array<{ legacyId: number; publicUrl: string }>;
    };
    for (const a of doc.assets ?? []) {
      map.set(a.legacyId, a.publicUrl);
    }
  } catch {
    // publish-catalog-media not run yet
  }
  return map;
}

function resolveImages(
  imageIds: number[] | undefined,
  media: MediaPublicIndex,
): { coverImageUrl: string | null; imageUrls: string[] } {
  const imageUrls = (imageIds ?? [])
    .map((id) => media.get(id))
    .filter((u): u is string => Boolean(u));
  return {
    coverImageUrl: imageUrls[0] ?? null,
    imageUrls,
  };
}

function fromManifest(
  p: ManifestProduct,
  locale: Locale,
  media: MediaPublicIndex,
): ProductPublic {
  const images = resolveImages(p.imageIds, media);
  return {
    id: p.id ?? `legacy-${p.legacyId}`,
    legacyId: p.legacyId,
    sku: p.sku,
    category: p.category,
    motif: p.motif,
    status: p.status ?? 'published',
    priceCents: p.priceCents,
    currency: 'EUR',
    saleEnabled: p.saleEnabled ?? false,
    inventoryMode: p.inventoryMode ?? 'unverified',
    availability: p.availability ?? 'unverified',
    slug: p.slug[locale],
    title: p.title[locale],
    summary: p.summary?.[locale] ?? '',
    description: p.description?.[locale] ?? '',
    coverImageUrl: images.coverImageUrl,
    imageUrls: images.imageUrls,
  };
}

async function localImagesBySku(): Promise<Map<string, string[]>> {
  const media = await loadMediaPublicIndex();
  const map = new Map<string, string[]>();
  try {
    const raw = await readFile(path.join(process.cwd(), 'migration', 'products.json'), 'utf8');
    const data = JSON.parse(raw) as { products?: ManifestProduct[] } | ManifestProduct[];
    const products = Array.isArray(data) ? data : (data.products ?? []);
    for (const product of products) {
      map.set(product.sku, resolveImages(product.imageIds, media).imageUrls);
    }
  } catch {
    // local catalog not published yet
  }
  return map;
}

async function loadFromMigration(locale: Locale): Promise<ProductPublic[]> {
  const file = path.join(process.cwd(), 'migration', 'products.json');
  try {
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw) as { products?: ManifestProduct[] } | ManifestProduct[];
    const products = Array.isArray(data) ? data : (data.products ?? []);
    const media = await loadMediaPublicIndex();
    return products.map((p) => fromManifest(p, locale, media));
  } catch {
    return [];
  }
}

async function loadFromSupabase(locale: Locale): Promise<ProductPublic[] | null> {
  if (!hasSupabase()) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = import.meta.env.PUBLIC_SUPABASE_URL as string;
    const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;
    const client = createClient(url, key);
    const [products, translations, images] = await Promise.all([
      client.from('catalog_products_v').select('*').order('editorial_order'),
      client.from('catalog_product_translations_v').select('*').eq('locale', locale),
      client.from('catalog_product_images_v').select('*').order('position'),
    ]);
    if (products.error || !products.data) return null;

    const copy = new Map(
      (translations.data ?? []).map((row) => [String(row.product_id), row]),
    );
    const photos = new Map<string, string[]>();
    for (const image of images.data ?? []) {
      const id = String(image.product_id);
      const src = storagePublicUrl(String(image.bucket), String(image.object_path));
      const list = photos.get(id) ?? [];
      if (image.is_cover) list.unshift(src);
      else list.push(src);
      photos.set(id, list);
    }

    // Storage upload needs the secret key. Until those files exist, keep the
    // published local catalog photos matched by SKU.
    const missingPhotos = products.data.some(
      (row) => (photos.get(String(row.id)) ?? []).length === 0,
    );
    const localBySku = missingPhotos ? await localImagesBySku() : new Map<string, string[]>();

    const ownPhotos = (row: Record<string, unknown>) => {
      const stored = photos.get(String(row.id)) ?? [];
      return stored.length > 0 ? stored : (localBySku.get(String(row.sku ?? '')) ?? []);
    };
    const byId = new Map(products.data.map((row) => [String(row.id), row]));
    const text = (value: unknown) => (typeof value === 'string' ? value : '');

    return products.data.map((row) => {
      const tr = copy.get(String(row.id));
      const parent = row.parent_id ? byId.get(String(row.parent_id)) : undefined;
      const parentTr = parent ? copy.get(String(parent.id)) : undefined;
      const own = ownPhotos(row);
      const urls = own.length > 0 || !parent ? own : ownPhotos(parent);
      const category = String(row.category_code ?? 'greeting-cards') as ProductPublic['category'];
      return {
        id: String(row.id),
        legacyId: null,
        sku: String(row.sku ?? ''),
        category,
        motif: String(row.motif ?? ''),
        status: (row.status as ProductPublic['status']) ?? 'published',
        priceCents: Number(row.price_cents ?? 0),
        currency: 'EUR' as const,
        saleEnabled: Boolean(row.sale_enabled),
        inventoryMode: (row.inventory_mode as ProductPublic['inventoryMode']) || 'unverified',
        availability: (row.availability as ProductPublic['availability']) || 'unverified',
        slug: String(tr?.slug ?? row.sku ?? ''),
        title: String(tr?.title ?? row.sku ?? ''),
        summary: text(tr?.summary) || text(parentTr?.summary),
        description: text(tr?.description) || text(parentTr?.description),
        coverImageUrl: urls[0] ?? null,
        imageUrls: urls,
        parentId: row.parent_id ? String(row.parent_id) : null,
        variantLabel: text(locale === 'es' ? row.variant_label_es : row.variant_label_en),
        variantOrder: row.variant_order == null ? null : Number(row.variant_order),
        seoTitle: text(tr?.seo_title) || null,
        seoDescription: text(tr?.seo_description) || null,
      } satisfies ProductPublic;
    });
  } catch {
    return null;
  }
}

export async function loadPublicCatalog(locale: Locale): Promise<{
  products: ProductPublic[];
  source: CatalogSource;
}> {
  if (hasSupabase()) {
    const fromDb = await loadFromSupabase(locale);
    if (fromDb !== null) {
      return { products: fromDb, source: 'supabase' };
    }
  }

  const fromFile = await loadFromMigration(locale);
  if (fromFile.length > 0) {
    return { products: fromFile, source: 'migration' };
  }

  return { products: [], source: 'empty' };
}

/** @deprecated Prefer loadPublicCatalog for source awareness. */
export async function loadManifestProducts(
  locale: Locale,
): Promise<ProductPublic[]> {
  const { products } = await loadPublicCatalog(locale);
  return products;
}

export async function loadManifestProductBySlug(
  locale: Locale,
  slug: string,
): Promise<ProductPublic | null> {
  const all = await loadManifestProducts(locale);
  return all.find((p) => p.slug === slug) ?? null;
}

/** Products listed in the shop; variations appear inside their parent's page. */
export function topLevelProducts(products: ProductPublic[]): ProductPublic[] {
  return products.filter((p) => !p.parentId);
}

/**
 * The page product (always the parent), its options with the parent first,
 * and the option the slug pointed at.
 */
export async function loadProductPage(
  locale: Locale,
  slug: string,
): Promise<{ product: ProductPublic; options: ProductPublic[]; selected: ProductPublic } | null> {
  const all = await loadManifestProducts(locale);
  const hit = all.find((p) => p.slug === slug);
  if (!hit) return null;
  const product = hit.parentId ? all.find((p) => p.id === hit.parentId) : hit;
  if (!product) return null;
  const children = all
    .filter((p) => p.parentId === product.id)
    .sort((a, b) => (a.variantOrder ?? 0) - (b.variantOrder ?? 0));
  return { product, options: [product, ...children], selected: hit };
}
