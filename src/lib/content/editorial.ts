import { getCollection } from 'astro:content';
import { anonDb, hasDatabase, ident } from '@/lib/server/db';
import { resolveMediaUrl } from '@/lib/server/storageUrl';

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
    .map((entry) => ({
      id: entry.data.id,
      data: {
        ...entry.data,
        assets: entry.data.assets.map((asset) => ({ ...asset, src: resolveMediaUrl(asset.src) })),
      },
    }))
    .sort((a, b) => a.data.order - b.data.order);
}

async function galleryFromFiles(): Promise<GalleryEntry[]> {
  const rows = await getCollection('gallery');
  return rows
    .map((entry) => ({
      id: entry.data.id,
      data: {
        ...entry.data,
        assets: entry.data.assets.map((asset) => ({ ...asset, src: resolveMediaUrl(asset.src) })),
      },
    }))
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
        const src = resolveMediaUrl(String(asset.src ?? ''));
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
        const src = resolveMediaUrl(String(asset.src ?? ''));
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

/** Rows of the view; null without a database; 'failed' when it could not be read. */
async function fromView<T>(
  view: 'editorial_artworks_v' | 'editorial_gallery_v',
  map: (row: Record<string, unknown>) => T | null,
): Promise<T[] | null | 'failed'> {
  if (!hasDatabase()) return null;
  try {
    const client = anonDb();
    const data = await client.rows<Record<string, unknown>>`select * from ${ident('public', view)} order by sort_order`;
    return data.flatMap((row) => {
      const mapped = map(row as Record<string, unknown>);
      return mapped ? [mapped] : [];
    });
  } catch {
    return 'failed';
  }
}

/**
 * The entries and whether they are a stand-in: the database could not be
 * read, so these are the content files, which may lack recent pieces. A
 * detail page then answers "try later" rather than "not found".
 */
export type Loaded<T> = { items: T[]; stale: boolean };

async function withFallback<T>(remote: T[] | null | 'failed', files: () => Promise<T[]>): Promise<Loaded<T>> {
  if (Array.isArray(remote) && remote.length > 0) return { items: remote, stale: false };
  return { items: await files(), stale: remote === 'failed' };
}

/** Published artwork sheets, with where they came from. */
export async function loadWorksFrom(): Promise<Loaded<WorkEntry>> {
  return withFallback(await fromView('editorial_artworks_v', mapWork), worksFromFiles);
}

/** Published extra-gallery items, with where they came from. */
export async function loadGalleryFrom(): Promise<Loaded<GalleryEntry>> {
  return withFallback(await fromView('editorial_gallery_v', mapGallery), galleryFromFiles);
}

/** Published artwork sheets. Supabase when the editorial migration is applied, otherwise the content files. */
export async function loadWorks(): Promise<WorkEntry[]> {
  return (await loadWorksFrom()).items;
}

/** Published extra-gallery items. Same fallback as loadWorks. */
export async function loadGallery(): Promise<GalleryEntry[]> {
  return (await loadGalleryFrom()).items;
}
