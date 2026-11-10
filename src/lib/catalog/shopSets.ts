import type { Locale } from '@/i18n/routes';
import type { ProductPublic } from '@/lib/domain/types';
import { hasSupabase } from '@/lib/server/env';
import { storagePublicUrl } from '@/lib/server/storageUrl';

/**
 * The shop is arranged by shop category: one portrait (Pug, Cockapoo…) and
 * the products printed with it. Categories are edited in Admin › Tienda ›
 * Categorías (table shop_collections).
 */

export type ShopCollection = {
  id: string;
  code: string;
  name: string;
  description: string;
  portraitUrl: string | null;
  sortOrder: number;
};

export type ShopSet = {
  /** The category's code, used in ?breed= links */
  id: string;
  name: string;
  description: string;
  portrait: string | null;
  items: ProductPublic[];
};

const TYPE_ORDER = ['greeting-cards', 'coasters', 'mugs', 'ornaments', 'keyrings'];

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Visible shop categories, in their order. Empty when they cannot be read. */
export async function loadShopCollections(locale: Locale): Promise<ShopCollection[]> {
  if (!hasSupabase()) return [];
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL as string,
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string,
    );
    const { data, error } = await client.from('catalog_collections_v').select('*').order('sort_order');
    if (error || !data) return [];
    return data.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(locale === 'es' ? row.name_es : row.name_en),
      description: String((locale === 'es' ? row.description_es : row.description_en) ?? ''),
      portraitUrl:
        row.portrait_bucket && row.portrait_path
          ? storagePublicUrl(String(row.portrait_bucket), String(row.portrait_path))
          : null,
      sortOrder: Number(row.sort_order ?? 0),
    }));
  } catch {
    return [];
  }
}

const byType = (a: ProductPublic, b: ProductPublic) =>
  TYPE_ORDER.indexOf(a.category) - TYPE_ORDER.indexOf(b.category);

/** The coaster photo shows the drawing flat and centred: the best portrait. */
const portraitOf = (items: ProductPublic[]) =>
  items.find((p) => p.category === 'coasters')?.coverImageUrl ??
  items.find((p) => p.coverImageUrl)?.coverImageUrl ??
  null;

/**
 * Group the shop's products by category, in the categories' order. Products
 * without a category are grouped by their motif after them, as the shop did
 * before categories existed; products of a hidden category are left out.
 */
export function buildShopSets(products: ProductPublic[], collections: ShopCollection[]): ShopSet[] {
  const known = new Map(collections.map((c) => [c.id, c]));
  const sets: ShopSet[] = [...collections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.code, name: c.name, description: c.description, portrait: c.portraitUrl, items: [] }));
  const byCode = new Map(sets.map((s) => [s.id, s]));

  for (const product of products) {
    if (product.collectionId) {
      const collection = known.get(product.collectionId);
      // A hidden (or deleted) category takes its products out of the shop list.
      if (collection) byCode.get(collection.code)!.items.push(product);
      continue;
    }
    const id = slugify(product.motif || product.title);
    let set = byCode.get(id);
    if (!set) {
      set = { id, name: product.motif || product.title, description: '', portrait: null, items: [] };
      sets.push(set);
      byCode.set(id, set);
    }
    set.items.push(product);
  }

  return sets
    .filter((s) => s.items.length > 0)
    .map((s) => {
      const items = [...s.items].sort(byType);
      return { ...s, items, portrait: s.portrait ?? portraitOf(items) };
    });
}
