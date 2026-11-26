/**
 * Cloudinary media storage: delivery URLs and the signed upload, delete and
 * list calls. Self-contained (no path aliases) so scripts can import it too.
 */
import { createHash } from 'node:crypto';

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };
export type ImageFormat = 'auto' | 'jpg';
type Deps = { fetchImpl?: typeof fetch; now?: () => number };

const API = 'https://api.cloudinary.com/v1_1';
const DELIVERY = 'https://res.cloudinary.com';
/** Never send more than 2000 px on the long side, whatever was uploaded. */
const SIZE_CAP = 'c_limit,w_2000';

export class CloudinaryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudinaryError';
    this.status = status;
  }
}

/** `cloudinary://<api_key>:<api_secret>@<cloud_name>`, as Cloudinary's console prints it. */
export function parseCloudinaryUrl(value: string | null | undefined): CloudinaryConfig | null {
  const match = String(value ?? '').trim().match(/^cloudinary:\/\/([^:@/]+):([^@/]+)@([^/?#]+)$/);
  if (!match) return null;
  return { apiKey: match[1]!, apiSecret: match[2]!, cloudName: match[3]! };
}

/**
 * Where a stored object lives in Cloudinary: `<bucket>/<path>` with the final
 * `.ext` turned into `_ext`. A dot would be read as the delivery format, and
 * dropping the extension would make `logo.jpg` and `logo.png` the same image.
 */
export function mediaPublicId(bucket: string, objectPath: string): string {
  const path = objectPath.split('/').filter(Boolean).join('/');
  return `${bucket}/${path.replace(/\.([a-z0-9]+)$/i, '_$1')}`;
}

export function cloudinaryImageUrl(cloudName: string, publicId: string, format: ImageFormat = 'auto'): string {
  const path = publicId.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${DELIVERY}/${cloudName}/image/upload/${SIZE_CAP}/f_${format}/q_auto/${path}`;
}

/** Product feeds want a fixed, widely supported format rather than whatever the crawler accepts. */
export function jpegDeliveryUrl(url: string): string {
  if (!url.startsWith(`${DELIVERY}/`)) return url;
  return url.replace(`/${SIZE_CAP}/f_auto/`, `/${SIZE_CAP}/f_jpg/`);
}

/** SHA-1 of the sorted `key=value` pairs followed by the API secret. */
export function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(payload + apiSecret).digest('hex');
}

function signedForm(config: CloudinaryConfig, params: Record<string, string>, now: () => number): FormData {
  const timestamp = Math.floor(now() / 1000);
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set('timestamp', String(timestamp));
  form.set('api_key', config.apiKey);
  form.set('signature', signCloudinaryParams({ ...params, timestamp }, config.apiSecret));
  return form;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as { message?: string } | undefined;
    throw new CloudinaryError(error?.message ?? `Cloudinary answered ${response.status}`, response.status);
  }
  return body;
}

export async function uploadImage(
  config: CloudinaryConfig,
  image: { bytes: Uint8Array<ArrayBuffer>; contentType: string; publicId: string },
  { fetchImpl = fetch, now = Date.now }: Deps = {},
): Promise<{ publicId: string; bytes: number }> {
  const form = signedForm(config, { overwrite: 'false', public_id: image.publicId }, now);
  form.set('file', new Blob([image.bytes], { type: image.contentType }));
  const response = await fetchImpl(`${API}/${config.cloudName}/image/upload`, { method: 'POST', body: form });
  const body = await readJson(response);
  return { publicId: String(body.public_id), bytes: Number(body.bytes) };
}

/**
 * A private image (a customer's photos): uploaded as `authenticated`, so no
 * public URL serves it; it is read through privateDownloadUrl, signed and short-lived.
 */
export async function uploadPrivateImage(
  config: CloudinaryConfig,
  image: { bytes: Uint8Array<ArrayBuffer>; contentType: string; publicId: string },
  { fetchImpl = fetch, now = Date.now }: Deps = {},
): Promise<{ publicId: string; bytes: number }> {
  const form = signedForm(config, { overwrite: 'false', public_id: image.publicId, type: 'authenticated' }, now);
  form.set('file', new Blob([image.bytes], { type: image.contentType }));
  const response = await fetchImpl(`${API}/${config.cloudName}/image/upload`, { method: 'POST', body: form });
  const body = await readJson(response);
  return { publicId: String(body.public_id), bytes: Number(body.bytes) };
}

/** A signed, expiring link to download a private image (as JPEG). */
export function privateDownloadUrl(
  config: CloudinaryConfig,
  publicId: string,
  { now = Date.now, ttlSeconds = 600 }: { now?: () => number; ttlSeconds?: number } = {},
): string {
  const timestamp = Math.floor(now() / 1000);
  const params: Record<string, string> = {
    public_id: publicId,
    type: 'authenticated',
    format: 'jpg',
    expires_at: String(timestamp + ttlSeconds),
    timestamp: String(timestamp),
  };
  const query = new URLSearchParams({
    ...params,
    api_key: config.apiKey,
    signature: signCloudinaryParams(params, config.apiSecret),
  });
  return `${API}/${config.cloudName}/image/download?${query}`;
}

/** Deletes a private image (a customer's photo). */
export async function destroyPrivateImage(
  config: CloudinaryConfig,
  publicId: string,
  { fetchImpl = fetch, now = Date.now }: Deps = {},
): Promise<'ok' | 'not found'> {
  const form = signedForm(config, { invalidate: 'true', public_id: publicId, type: 'authenticated' }, now);
  const response = await fetchImpl(`${API}/${config.cloudName}/image/destroy`, { method: 'POST', body: form });
  const body = await readJson(response);
  if (body.result === 'ok' || body.result === 'not found') return body.result;
  throw new CloudinaryError(`Cloudinary could not delete ${publicId}: ${String(body.result)}`, response.status);
}

/** Deletes the image and purges it from the CDN. An image that is already gone counts as deleted. */
export async function destroyImage(
  config: CloudinaryConfig,
  publicId: string,
  { fetchImpl = fetch, now = Date.now }: Deps = {},
): Promise<'ok' | 'not found'> {
  const form = signedForm(config, { invalidate: 'true', public_id: publicId }, now);
  const response = await fetchImpl(`${API}/${config.cloudName}/image/destroy`, { method: 'POST', body: form });
  const body = await readJson(response);
  if (body.result === 'ok' || body.result === 'not found') return body.result;
  throw new CloudinaryError(`Cloudinary could not delete ${publicId}: ${String(body.result)}`, response.status);
}

/** Every uploaded image whose public id starts with `prefix` (Admin API, rate limited). */
export async function listImagePublicIds(
  config: CloudinaryConfig,
  prefix: string,
  { fetchImpl = fetch }: Deps = {},
): Promise<Set<string>> {
  const ids = new Set<string>();
  const authorization = `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`;
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ prefix, max_results: '500' });
    if (cursor) query.set('next_cursor', cursor);
    const response = await fetchImpl(`${API}/${config.cloudName}/resources/image/upload?${query}`, {
      headers: { authorization },
    });
    const body = await readJson(response);
    for (const resource of (body.resources ?? []) as Array<{ public_id: string }>) ids.add(resource.public_id);
    cursor = typeof body.next_cursor === 'string' ? body.next_cursor : undefined;
  } while (cursor);
  return ids;
}
