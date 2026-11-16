import { cloudinaryImageUrl, mediaPublicId, parseCloudinaryUrl } from '@/lib/server/media/cloudinary';

function supabaseBase(): string {
  return String(import.meta.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
}

function cloudinaryCloud(): string | null {
  return parseCloudinaryUrl(import.meta.env.CLOUDINARY_URL)?.cloudName ?? null;
}

function supabaseStorageUrl(bucket: string, objectPath: string): string {
  const path = objectPath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${supabaseBase()}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Public URL for a stored media object. Media lives in Cloudinary; until
 * CLOUDINARY_URL is set, links keep pointing at the Supabase Storage copy.
 */
export function storagePublicUrl(bucket: string, objectPath: string): string {
  const cloud = cloudinaryCloud();
  if (cloud) return cloudinaryImageUrl(cloud, mediaPublicId(bucket, objectPath));
  return supabaseStorageUrl(bucket, objectPath);
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

/** `<bucket>` and `<path>` of a Supabase Storage public link, from any project. */
function parseSupabaseStorageUrl(src: string): [bucket: string, objectPath: string] | null {
  const match = src.match(/^https:\/\/[^/]+\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!match) return null;
  try {
    return [match[1]!, match[2]!.split('/').map((part) => decodeURIComponent(part)).join('/')];
  } catch {
    return null;
  }
}

/**
 * Media references saved as local `/media/...` paths (those files are not
 * deployed) or as old Supabase Storage links, turned into the current URL.
 */
export function resolveMediaUrl(src: string | null | undefined): string {
  if (!src) return '';
  const saved = cloudinaryCloud() ? parseSupabaseStorageUrl(src) : null;
  if (saved) return storagePublicUrl(saved[0], saved[1]);
  if (/^https?:\/\//i.test(src)) return src;
  const match = src.match(/^\/media\/([^/]+)\/(.+)$/);
  const mapped = match ? MEDIA_FOLDERS[match[1]!] : undefined;
  if (!match || !mapped || (!cloudinaryCloud() && !supabaseBase())) return src;
  return storagePublicUrl(mapped[0], `${mapped[1]}/${match[2]}`);
}
