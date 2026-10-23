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
