import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
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

type Translation = { locale: string; alt_text: string; caption: string };

export async function listMedia(client: SupabaseClient): Promise<MediaRow[]> {
  const { data, error } = await client
    .from('media_assets')
    .select(
      'id, bucket, object_path, mime_type, byte_size, processing_status, created_at, media_translations(locale, alt_text, caption)',
    )
    .order('created_at', { ascending: false });
  if (error) throw mapPgError(error);
  return (data ?? []).map((row) => {
    const translations = (row.media_translations ?? []) as Translation[];
    const en = translations.find((t) => t.locale === 'en');
    const es = translations.find((t) => t.locale === 'es');
    return {
      id: row.id as string,
      bucket: row.bucket as string,
      object_path: row.object_path as string,
      mime_type: row.mime_type as string,
      byte_size: (row.byte_size as number | null) ?? null,
      processing_status: row.processing_status as string,
      created_at: row.created_at as string,
      publicUrl: storagePublicUrl(row.bucket as string, row.object_path as string),
      altEn: en?.alt_text ?? '',
      altEs: es?.alt_text ?? '',
    };
  });
}

export async function saveMediaAlts(
  client: SupabaseClient,
  id: string,
  altEn: string,
  altEs: string,
): Promise<void> {
  const rows = [
    { media_asset_id: id, locale: 'en', alt_text: altEn, caption: '' },
    { media_asset_id: id, locale: 'es', alt_text: altEs, caption: '' },
  ];
  const { error } = await client
    .from('media_translations')
    .upsert(rows, { onConflict: 'media_asset_id,locale' });
  if (error) throw mapPgError(error);
}

export async function deleteMedia(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client
    .from('media_assets')
    .select('bucket, object_path')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgError(error);
  if (!data) throw new CommerceError('VALIDATION', 'Media not found', 404);
  const removed = await client.storage.from(data.bucket).remove([data.object_path]);
  if (removed.error) throw mapPgError(removed.error);
  const del = await client.from('media_assets').delete().eq('id', id);
  if (del.error) throw mapPgError(del.error);
}

const buckets = new Set(['portfolio-public', 'catalog-public']);

export async function uploadMedia(
  client: SupabaseClient,
  file: File,
  bucket: string,
  altEn: string,
  altEs: string,
): Promise<MediaRow> {
  if (!buckets.has(bucket)) {
    throw new CommerceError('VALIDATION', 'Unknown media bucket', 400);
  }
  if (!file.type.startsWith('image/')) {
    throw new CommerceError('VALIDATION', 'Only images can be uploaded', 400);
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new CommerceError('VALIDATION', 'Image is larger than 20 MB', 400);
  }
  const safe = file.name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe || 'image'}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await client.storage.from(bucket).upload(objectPath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploaded.error) throw mapPgError(uploaded.error);

  const inserted = await client
    .from('media_assets')
    .insert({
      origin: 'upload',
      bucket,
      object_path: objectPath,
      mime_type: file.type,
      byte_size: file.size,
      processing_status: 'ready',
    })
    .select('id, bucket, object_path, mime_type, byte_size, processing_status, created_at')
    .single();
  if (inserted.error || !inserted.data) {
    await client.storage.from(bucket).remove([objectPath]);
    if (inserted.error) throw mapPgError(inserted.error);
    throw new CommerceError('INTERNAL', 'Could not record the upload', 500);
  }
  await saveMediaAlts(client, inserted.data.id, altEn, altEs);
  return {
    ...inserted.data,
    publicUrl: storagePublicUrl(bucket, objectPath),
    altEn,
    altEs,
  };
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

export async function listArtworks(client: SupabaseClient) {
  const { data, error } = await client
    .from('artworks')
    .select(
      'id, legacy_id, slug_en, slug_es, category, title_es, title_en, summary_es, story_es, sort_order, published, updated_at, artwork_assets(src, role, sort_order)',
    )
    .order('sort_order');
  if (error) throw mapPgError(error);
  return (data ?? []).map((row) => ({
    ...row,
    cover: coverOf(row.artwork_assets as AssetPreview[] | null),
  }));
}

type AssetPreview = { src: string; role: string; sort_order: number };

function coverOf(assets: AssetPreview[] | null): string | null {
  const sorted = [...(assets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return (sorted.find((a) => a.role === 'drawing') ?? sorted[0])?.src ?? null;
}

export async function getArtwork(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from('artworks')
    .select('*, artwork_assets(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgError(error);
  return data;
}

async function replaceAssets(
  client: SupabaseClient,
  table: 'artwork_assets' | 'gallery_assets',
  column: 'artwork_id' | 'gallery_item_id',
  id: string,
  rows: Record<string, unknown>[],
) {
  const removed = await client.from(table).delete().eq(column, id);
  if (removed.error) throw mapPgError(removed.error);
  if (rows.length === 0) return;
  const inserted = await client.from(table).insert(rows);
  if (inserted.error) throw mapPgError(inserted.error);
}

export async function createArtwork(client: SupabaseClient, input: ArtworkInput) {
  const { data, error } = await client
    .from('artworks')
    .insert({
      legacy_id: input.legacyId || null,
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
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error) throw mapPgError(error);
    throw new CommerceError('INTERNAL', 'Could not create the artwork', 500);
  }
  await replaceAssets(
    client,
    'artwork_assets',
    'artwork_id',
    data.id,
    assetRows(input.assets, 'artwork', data.id),
  );
  return data.id as string;
}

export async function updateArtwork(client: SupabaseClient, id: string, input: ArtworkInput) {
  const { error } = await client
    .from('artworks')
    .update({
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
    })
    .eq('id', id);
  if (error) throw mapPgError(error);
  await replaceAssets(
    client,
    'artwork_assets',
    'artwork_id',
    id,
    assetRows(input.assets, 'artwork', id),
  );
}

export async function listGallery(client: SupabaseClient) {
  const { data, error } = await client
    .from('gallery_items')
    .select(
      'id, legacy_id, item_group, title_es, title_en, summary_es, story_es, sort_order, published, updated_at, gallery_assets(src, role, sort_order)',
    )
    .order('sort_order');
  if (error) throw mapPgError(error);
  return (data ?? []).map((row) => ({
    ...row,
    cover: coverOf(row.gallery_assets as AssetPreview[] | null),
  }));
}

export async function getGalleryItem(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from('gallery_items')
    .select('*, gallery_assets(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgError(error);
  return data;
}

export async function createGalleryItem(client: SupabaseClient, input: GalleryInput) {
  const { data, error } = await client
    .from('gallery_items')
    .insert({
      legacy_id: input.legacyId || null,
      item_group: input.group,
      title_en: input.titleEn,
      title_es: input.titleEs,
      summary_en: input.summaryEn,
      summary_es: input.summaryEs,
      story_en: input.storyEn,
      story_es: input.storyEs,
      sort_order: input.sortOrder,
      published: input.published,
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error) throw mapPgError(error);
    throw new CommerceError('INTERNAL', 'Could not create the gallery item', 500);
  }
  await replaceAssets(
    client,
    'gallery_assets',
    'gallery_item_id',
    data.id,
    assetRows(input.assets, 'gallery', data.id),
  );
  return data.id as string;
}

export async function updateGalleryItem(
  client: SupabaseClient,
  id: string,
  input: GalleryInput,
) {
  const { error } = await client
    .from('gallery_items')
    .update({
      item_group: input.group,
      title_en: input.titleEn,
      title_es: input.titleEs,
      summary_en: input.summaryEn,
      summary_es: input.summaryEs,
      story_en: input.storyEn,
      story_es: input.storyEs,
      sort_order: input.sortOrder,
      published: input.published,
    })
    .eq('id', id);
  if (error) throw mapPgError(error);
  await replaceAssets(
    client,
    'gallery_assets',
    'gallery_item_id',
    id,
    assetRows(input.assets, 'gallery', id),
  );
}