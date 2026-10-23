/** Public object URL for a Supabase Storage bucket. */
export function storagePublicUrl(bucket: string, objectPath: string): string {
  const base = String(import.meta.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const path = objectPath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

const MEDIA_FOLDERS: Record<string, [bucket: string, prefix: string]> = {
  catalog: ['catalog-public', 'catalog'],
  portfolio: ['portfolio-public', 'portfolio'],
  gallery: ['portfolio-public', 'gallery'],
  about: ['portfolio-public', 'about'],
  feedbacks: ['portfolio-public', 'feedbacks'],
  commissionExamples: ['portfolio-public', 'commission-examples'],
  brand: ['portfolio-public', 'brand'],
};

/**
 * Local `/media/...` files are not deployed. The same files live in Storage,
 * so public pages use that URL when Supabase is configured.
 */
export function resolveMediaUrl(src: string | null | undefined): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  const match = src.match(/^\/media\/([^/]+)\/(.+)$/);
  const mapped = match ? MEDIA_FOLDERS[match[1]] : undefined;
  const base = String(import.meta.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  if (!match || !mapped || !base) return src;
  return storagePublicUrl(mapped[0], `${mapped[1]}/${match[2]}`);
}
