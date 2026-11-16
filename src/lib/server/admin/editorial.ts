import { ident, insertValues, setColumns, type Db } from '@/lib/server/db';
import type { ArtworkAssetsRow, ArtworksRow, GalleryAssetsRow, GalleryItemsRow } from '@/lib/server/dbTypes';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { mediaPublicId } from '@/lib/server/media/cloudinary';
import { cloudinaryStore, mediaStoreError, type MediaStore } from '@/lib/server/media/store';
import { storagePublicUrl } from '@/lib/server/storageUrl';

export type MediaRow = {
  id: string;
  bucket: string;
  object_path: string;
  mime_type: string;
  byte_size: number | null;
  processing_status: string;
  created_at: string;
  publicUrl: string;
  altEn: string;
  altEs: string;
};

export async function listMedia(client: Db): Promise<MediaRow[]> {
  const rows = await dbCall(() =>
    client.rows<Omit<MediaRow, 'publicUrl'>>`
      select m.id, m.bucket, m.object_path, m.mime_type, m.byte_size, m.processing_status, m.created_at,
             coalesce((select t.alt_text from public.media_translations t where t.media_asset_id = m.id and t.locale = 'en'), '') as "altEn",
             coalesce((select t.alt_text from public.media_translations t where t.media_asset_id = m.id and t.locale = 'es'), '') as "altEs"
      from public.media_assets m
      order by m.created_at desc`,
  );
  return rows.map((row) => ({ ...row, publicUrl: storagePublicUrl(row.bucket, row.object_path) }));
}

export async function saveMediaAlts(client: Db, id: string, altEn: string, altEs: string): Promise<void> {
  await dbCall(() => client.run`
    insert into public.media_translations ${insertValues([
      { media_asset_id: id, locale: 'en', alt_text: altEn, caption: '' },
      { media_asset_id: id, locale: 'es', alt_text: altEs, caption: '' },
    ])}
    on conflict (media_asset_id, locale) do update set alt_text = excluded.alt_text, caption = excluded.caption`);
}

export async function deleteMedia(client: Db, id: string, store: MediaStore = cloudinaryStore()): Promise<void> {
  const data = await dbCall(() =>
    client.one<{ bucket: string; object_path: string }>`select bucket, object_path from public.media_assets where id = ${id}`,
  );
  if (!data) throw new CommerceError('VALIDATION', 'Media not found', 404);
  await store.remove(mediaPublicId(data.bucket, data.object_path)).catch((err: unknown) => {
    throw mediaStoreError(err);
  });
  await dbCall(() => client.run`delete from public.media_assets where id = ${id}`);
}

const buckets = new Set(['portfolio-public', 'catalog-public']);

export async function uploadMedia(
  client: Db,
  file: File,
  bucket: string,
  altEn: string,
  altEs: string,
  store: MediaStore = cloudinaryStore(),
): Promise<MediaRow> {
  if (!buckets.has(bucket)) {
    throw new CommerceError('VALIDATION', 'Unknown media bucket', 400);
  }
  if (!file.type.startsWith('image/')) {
    throw new CommerceError('VALIDATION', 'Only images can be uploaded', 400);
  }
  // Largest image the Cloudinary free plan accepts.
  if (file.size > 10 * 1024 * 1024) {
    throw new CommerceError('VALIDATION', 'Image is larger than 10 MB', 400);
  }
  const safe = file.name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe || 'image'}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const publicId = mediaPublicId(bucket, objectPath);
  await store.put(publicId, bytes, file.type).catch((err: unknown) => {
    throw mediaStoreError(err);
  });

  let inserted: Omit<MediaRow, 'publicUrl' | 'altEn' | 'altEs'> | null;
  try {
    inserted = await dbCall(() =>
      client.one<Omit<MediaRow, 'publicUrl' | 'altEn' | 'altEs'>>`
        insert into public.media_assets ${insertValues({
          origin: 'upload',
          bucket,
          object_path: objectPath,
          mime_type: file.type,
          byte_size: file.size,
          processing_status: 'ready',
        })}
        returning id, bucket, object_path, mime_type, byte_size, processing_status, created_at`,
    );
  } catch (err) {
    await store.remove(publicId).catch(() => {});
    throw err;
  }
  if (!inserted) {
    await store.remove(publicId).catch(() => {});
    throw new CommerceError('INTERNAL', 'Could not record the upload', 500);
  }
  await saveMediaAlts(client, inserted.id, altEn, altEs);
  return { ...inserted, publicUrl: storagePublicUrl(bucket, objectPath), altEn, altEs };
}

export type AssetInput = {
  role: string;
  src: string;
  label?: string | null;
  altEn?: string;
  altEs?: string;
  mediaId?: string | null;
};

export type ArtworkInput = {
  legacyId?: string | null;
  slugEn: string;
  slugEs: string;
  category: string;
  titleEn: string;
  titleEs: string;
  summaryEn: string;
  summaryEs: string;
  storyEn: string;
  storyEs: string;
  seoTitleEn?: string;
  seoTitleEs?: string;
  seoDescriptionEn?: string;
  seoDescriptionEs?: string;
  sortOrder: number;
  published: boolean;
  assets: AssetInput[];
};

const artworkSeo = (input: ArtworkInput) => ({
  seo_title_en: input.seoTitleEn?.trim() ?? '',
  seo_title_es: input.seoTitleEs?.trim() ?? '',
  seo_description_en: input.seoDescriptionEn?.trim() ?? '',
  seo_description_es: input.seoDescriptionEs?.trim() ?? '',
});

export type GalleryInput = {
  legacyId?: string | null;
  group: string;
  titleEn: string;
  titleEs: string;
  summaryEn: string;
  summaryEs: string;
  storyEn: string;
  storyEs: string;
  sortOrder: number;
  published: boolean;
  assets: AssetInput[];
};

function assetRows(assets: AssetInput[], owner: 'artwork' | 'gallery', ownerId: string) {
  return assets
    .filter((asset) => asset.src.trim())
    .map((asset, index) => ({
      ...(owner === 'artwork' ? { artwork_id: ownerId } : { gallery_item_id: ownerId }),
      media_asset_id: asset.mediaId || null,
      role: asset.role,
      src: asset.src.trim(),
      ...(owner === 'artwork' ? { label: asset.label?.trim() || null } : {}),
      alt_en: asset.altEn ?? '',
      alt_es: asset.altEs ?? '',
      sort_order: index,
    }));
}

type AssetPreview = { src: string; role: string; sort_order: number };

function coverOf(assets: AssetPreview[] | null): string | null {
  const sorted = [...(assets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return (sorted.find((a) => a.role === 'drawing') ?? sorted[0])?.src ?? null;
}

export async function listArtworks(client: Db) {
  const rows = await dbCall(() =>
    client.rows<Omit<ArtworksRow, 'summary_en' | 'story_en' | 'created_at' | 'seo_title_en' | 'seo_title_es' | 'seo_description_en' | 'seo_description_es'> & { artwork_assets: AssetPreview[] }>`
      select a.id, a.legacy_id, a.slug_en, a.slug_es, a.category, a.title_es, a.title_en, a.summary_es, a.story_es,
             a.sort_order, a.published, a.updated_at,
             coalesce((select json_agg(json_build_object('src', x.src, 'role', x.role, 'sort_order', x.sort_order))
                       from public.artwork_assets x where x.artwork_id = a.id), '[]'::json) as artwork_assets
      from public.artworks a order by a.sort_order`,
  );
  return rows.map((row) => ({ ...row, cover: coverOf(row.artwork_assets) }));
}

export async function getArtwork(client: Db, id: string) {
  return dbCall(() =>
    client.one<ArtworksRow & { artwork_assets: ArtworkAssetsRow[] }>`
      select a.*, coalesce((select json_agg(x) from public.artwork_assets x where x.artwork_id = a.id), '[]'::json) as artwork_assets
      from public.artworks a where a.id = ${id}`,
  );
}

async function replaceAssets(
  client: Db,
  table: 'artwork_assets' | 'gallery_assets',
  column: 'artwork_id' | 'gallery_item_id',
  id: string,
  rows: Record<string, unknown>[],
) {
  await dbCall(async () => {
    await client.run`delete from ${ident('public', table)} where ${ident(column)} = ${id}`;
    if (rows.length > 0) await client.run`insert into ${ident('public', table)} ${insertValues(rows)}`;
  });
}

const artworkColumns = (input: ArtworkInput) => ({
  slug_en: input.slugEn,
  slug_es: input.slugEs,
  category: input.category,
  title_en: input.titleEn,
  title_es: input.titleEs,
  summary_en: input.summaryEn,
  summary_es: input.summaryEs,
  story_en: input.storyEn,
  story_es: input.storyEs,
  ...artworkSeo(input),
  sort_order: input.sortOrder,
  published: input.published,
});

export async function createArtwork(client: Db, input: ArtworkInput) {
  const row = await dbCall(() =>
    client.one<{ id: string }>`
      insert into public.artworks ${insertValues({ legacy_id: input.legacyId || null, ...artworkColumns(input) })}
      returning id`,
  );
  if (!row) throw new CommerceError('INTERNAL', 'Could not create the artwork', 500);
  await replaceAssets(client, 'artwork_assets', 'artwork_id', row.id, assetRows(input.assets, 'artwork', row.id));
  return row.id;
}

export async function updateArtwork(client: Db, id: string, input: ArtworkInput) {
  await dbCall(() => client.run`update public.artworks set ${setColumns(artworkColumns(input))} where id = ${id}`);
  await replaceAssets(client, 'artwork_assets', 'artwork_id', id, assetRows(input.assets, 'artwork', id));
}

export async function listGallery(client: Db) {
  const rows = await dbCall(() =>
    client.rows<Omit<GalleryItemsRow, 'summary_en' | 'story_en' | 'created_at'> & { gallery_assets: AssetPreview[] }>`
      select g.id, g.legacy_id, g.item_group, g.title_es, g.title_en, g.summary_es, g.story_es, g.sort_order,
             g.published, g.updated_at,
             coalesce((select json_agg(json_build_object('src', x.src, 'role', x.role, 'sort_order', x.sort_order))
                       from public.gallery_assets x where x.gallery_item_id = g.id), '[]'::json) as gallery_assets
      from public.gallery_items g order by g.sort_order`,
  );
  return rows.map((row) => ({ ...row, cover: coverOf(row.gallery_assets) }));
}

export async function getGalleryItem(client: Db, id: string) {
  return dbCall(() =>
    client.one<GalleryItemsRow & { gallery_assets: GalleryAssetsRow[] }>`
      select g.*, coalesce((select json_agg(x) from public.gallery_assets x where x.gallery_item_id = g.id), '[]'::json) as gallery_assets
      from public.gallery_items g where g.id = ${id}`,
  );
}

const galleryColumns = (input: GalleryInput) => ({
  item_group: input.group,
  title_en: input.titleEn,
  title_es: input.titleEs,
  summary_en: input.summaryEn,
  summary_es: input.summaryEs,
  story_en: input.storyEn,
  story_es: input.storyEs,
  sort_order: input.sortOrder,
  published: input.published,
});

export async function createGalleryItem(client: Db, input: GalleryInput) {
  const row = await dbCall(() =>
    client.one<{ id: string }>`
      insert into public.gallery_items ${insertValues({ legacy_id: input.legacyId || null, ...galleryColumns(input) })}
      returning id`,
  );
  if (!row) throw new CommerceError('INTERNAL', 'Could not create the gallery item', 500);
  await replaceAssets(client, 'gallery_assets', 'gallery_item_id', row.id, assetRows(input.assets, 'gallery', row.id));
  return row.id;
}

export async function updateGalleryItem(client: Db, id: string, input: GalleryInput) {
  await dbCall(() => client.run`update public.gallery_items set ${setColumns(galleryColumns(input))} where id = ${id}`);
  await replaceAssets(client, 'gallery_assets', 'gallery_item_id', id, assetRows(input.assets, 'gallery', id));
}
