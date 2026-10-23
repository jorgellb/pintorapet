import { getCollection } from 'astro:content';
import { hasSupabase } from '@/lib/server/env';

export type WorkCategory = 'dog' | 'cat' | 'horse' | 'other' | 'people';
export type GalleryGroup = 'people' | 'architecture' | 'illustration' | 'other';

export type WorkAssetRole =
  | 'drawing'
  | 'reference_photo'
  | 'comparison'
  | 'process_photo'
  | 'related_product_photo';

export type GalleryAssetRole = 'drawing' | 'reference_photo' | 'other';

type Localized = { en: string; es: string };

export type WorkEntry = {
  id: string;
  data: {
    id: string;
    pathSlugs: Localized;
    title: Localized;
    category: WorkCategory;
    summary?: Localized;
    story?: Localized;
    seo?: { title: Partial<Localized>; description: Partial<Localized> };
    assets: Array<{
      role: WorkAssetRole;
      src?: string;
      label?: string | null;
      alt?: Localized;
    }>;
    order: number;
  };
};

export type GalleryEntry = {
  id: string;
  data: {
    id: string;
    title: Localized;
    summary?: Localized;
    story?: Localized;
    group: GalleryGroup;
    assets: Array<{
      role: GalleryAssetRole;
      src?: string;
      alt?: Localized;
    }>;
    order: number;
  };
};

const workCategories = new Set<WorkCategory>(['dog', 'cat', 'horse', 'other', 'people']);
const galleryGroups = new Set<GalleryGroup>([
  'people',
  'architecture',
  'illustration',
  'other',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function worksFromFiles(): Promise<WorkEntry[]> {
  const rows = await getCollection('work');
  return rows
    .map((entry) => ({ id: entry.data.id, data: entry.data }))
    .sort((a, b) => a.data.order - b.data.order);
}

async function galleryFromFiles(): Promise<GalleryEntry[]> {
  const rows = await getCollection('gallery');
  return rows
    .map((entry) => ({ id: entry.data.id, data: entry.data }))
    .sort((a, b) => a.data.order - b.data.order);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mapWork(row: Record<string, unknown>): WorkEntry | null {
  const category = String(row.category ?? '');
  if (!workCategories.has(category as WorkCategory)) return null;
  const legacy = typeof row.legacy_id === 'string' && row.legacy_id ? row.legacy_id : String(row.id);
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const summaryEn = String(row.summary_en ?? '');
  const summaryEs = String(row.summary_es ?? '');
  const storyEn = String(row.story_en ?? '');
  const storyEs = String(row.story_es ?? '');
  return {
    id: legacy,
    data: {
      id: legacy,
      pathSlugs: { en: String(row.slug_en ?? ''), es: String(row.slug_es ?? '') },
      title: { en: String(row.title_en ?? ''), es: String(row.title_es ?? '') },
      category: category as WorkCategory,
      summary: summaryEn || summaryEs ? { en: summaryEn, es: summaryEs } : undefined,
      story: storyEn || storyEs ? { en: storyEn, es: storyEs } : undefined,
      seo: {
        title: { en: optionalText(row.seo_title_en), es: optionalText(row.seo_title_es) },
        description: {
          en: optionalText(row.seo_description_en),
          es: optionalText(row.seo_description_es),
        },
      },
      assets: assets.flatMap((item) => {
        const asset = asRecord(item);
        if (!asset) return [];
        const src = String(asset.src ?? '');
        if (!src) return [];
        return [
          {
            role: String(asset.role ?? 'drawing') as WorkAssetRole,
            src,
            label: asset.label == null ? null : String(asset.label),
            alt: { en: String(asset.altEn ?? ''), es: String(asset.altEs ?? '') },
          },
        ];
      }),
      order: Number(row.sort_order ?? 0),
    },
  };
}

function mapGallery(row: Record<string, unknown>): GalleryEntry | null {
  const group = String(row.item_group ?? '');
  if (!galleryGroups.has(group as GalleryGroup)) return null;
  const legacy = typeof row.legacy_id === 'string' && row.legacy_id ? row.legacy_id : String(row.id);
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const summaryEn = String(row.summary_en ?? '');
  const summaryEs = String(row.summary_es ?? '');
  const storyEn = String(row.story_en ?? '');
  const storyEs = String(row.story_es ?? '');
  return {
    id: legacy,
    data: {
      id: legacy,
      title: { en: String(row.title_en ?? ''), es: String(row.title_es ?? '') },
      summary: summaryEn || summaryEs ? { en: summaryEn, es: summaryEs } : undefined,
      story: storyEn || storyEs ? { en: storyEn, es: storyEs } : undefined,
      group: group as GalleryGroup,
      assets: assets.flatMap((item) => {
        const asset = asRecord(item);
        if (!asset) return [];
        const src = String(asset.src ?? '');
        if (!src) return [];
        return [
          {
            role: String(asset.role ?? 'other') as GalleryAssetRole,
            src,
            alt: { en: String(asset.altEn ?? ''), es: String(asset.altEs ?? '') },
          },
        ];
      }),
      order: Number(row.sort_order ?? 0),
    },
  };
}

async function fromView<T>(
  view: 'editorial_artworks_v' | 'editorial_gallery_v',
  map: (row: Record<string, unknown>) => T | null,
): Promise<T[] | null> {
  if (!hasSupabase()) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL as string,
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string,
    );
    const { data, error } = await client.from(view).select('*').order('sort_order');
    if (error || !data) return null;
    return data.flatMap((row) => {
      const mapped = map(row as Record<string, unknown>);
      return mapped ? [mapped] : [];
    });
  } catch {
    return null;
  }
}

/** Published artwork sheets. Supabase when the editorial migration is applied, otherwise the content files. */
export async function loadWorks(): Promise<WorkEntry[]> {
  const remote = await fromView('editorial_artworks_v', mapWork);
  if (remote && remote.length > 0) return remote;
  return worksFromFiles();
}

/** Published extra-gallery items. Same fallback as loadWorks. */
export async function loadGallery(): Promise<GalleryEntry[]> {
  const remote = await fromView('editorial_gallery_v', mapGallery);
  if (remote && remote.length > 0) return remote;
  return galleryFromFiles();
}
