import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '@/lib/server/db';
import {
  destroyPrivateImage,
  parseCloudinaryUrl,
  privateDownloadUrl,
  uploadPrivateImage,
} from '@/lib/server/media/cloudinary';
import { CommerceError } from '@/lib/server/commerce/errors';

/**
 * The pet's photos sent with a commission request: private in Cloudinary,
 * seen only from Admin › Encargos (supabase/migrations/20261126000004_commission_photos.sql).
 */
export const MAX_PHOTOS = 10;
/** After the phone resizes it (2400 px JPEG), a photo is well under this. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const UPLOAD_WINDOW_HOURS = 2;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function cloudinary() {
  const config = parseCloudinaryUrl(import.meta.env.CLOUDINARY_URL);
  if (!config) throw new CommerceError('NOT_CONFIGURED', 'Photo storage is not configured', 503);
  return config;
}

/** A one-time key to upload the photos of the request just sent (kept as a hash). */
export async function openUploads(client: Db, commissionId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await client.run`
    update public.commission_requests
    set upload_token_hash = ${hash(token)}, upload_until = now() + make_interval(hours => ${UPLOAD_WINDOW_HOURS})
    where id = ${commissionId}`;
  return token;
}

/** The magic bytes of the formats taken: what the file is, not what it says it is. */
export function photoType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** Keep one photo of a request, checked against its upload key. */
export async function addPhoto(
  client: Db,
  input: { reference: string; token: string; file: File },
): Promise<{ id: string; count: number }> {
  const request = await client.one<{ id: string; upload_token_hash: string | null; open: boolean; count: number }>`
    select r.id, r.upload_token_hash, coalesce(r.upload_until > now(), false) as open,
           (select count(*)::int from public.commission_files f where f.commission_request_id = r.id) as count
    from public.commission_requests r where r.reference = ${input.reference}`;
  // Same answer for an unknown reference and a wrong key: nothing to learn from it.
  if (!request || !request.upload_token_hash || !request.open || request.upload_token_hash !== hash(input.token)) {
    throw new CommerceError('FORBIDDEN', 'UPLOAD_CLOSED', 403);
  }
  if (request.count >= MAX_PHOTOS) throw new CommerceError('VALIDATION', 'TOO_MANY_PHOTOS', 400);
  if (input.file.size <= 0 || input.file.size > MAX_PHOTO_BYTES) throw new CommerceError('VALIDATION', 'PHOTO_TOO_LARGE', 400);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const type = photoType(bytes);
  if (!type || !TYPES.has(type)) throw new CommerceError('VALIDATION', 'NOT_A_PHOTO', 400);

  const publicId = `commissions/${input.reference}/${randomUUID()}`;
  await uploadPrivateImage(cloudinary(), { bytes, contentType: type, publicId });
  const row = await client.one<{ id: string }>`
    insert into public.commission_files
      (commission_request_id, original_filename, mime_type, byte_size, status, storage_public_id)
    values (${request.id}, ${input.file.name.slice(0, 200) || 'foto.jpg'}, ${type}, ${bytes.byteLength}, 'accepted', ${publicId})
    returning id`;
  return { id: row!.id, count: request.count + 1 };
}

export type CommissionPhoto = { id: string; filename: string; bytes: number; createdAt: string };

export async function photosOf(client: Db, commissionId: string): Promise<CommissionPhoto[]> {
  const rows = await client.rows<{ id: string; original_filename: string; byte_size: number; created_at: string }>`
    select id, original_filename, byte_size, created_at from public.commission_files
    where commission_request_id = ${commissionId} and storage_public_id is not null
    order by created_at`;
  return rows.map((r) => ({ id: r.id, filename: r.original_filename, bytes: Number(r.byte_size), createdAt: r.created_at }));
}

/** The photo itself, for the admin (fetched through a signed, short-lived link). */
export async function photoFile(client: Db, commissionId: string, fileId: string): Promise<Response> {
  const row = await client.one<{ storage_public_id: string }>`
    select storage_public_id from public.commission_files
    where id = ${fileId} and commission_request_id = ${commissionId} and storage_public_id is not null`;
  if (!row) throw new CommerceError('UNAVAILABLE', 'Foto no encontrada.', 404);
  const res = await fetch(privateDownloadUrl(cloudinary(), row.storage_public_id, { ttlSeconds: 120 }));
  if (!res.ok) throw new CommerceError('UNAVAILABLE', 'Cloudinary no devolvió la foto.', 502);
  return new Response(res.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      // Private: only the admin's browser keeps it, for an hour.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Delete every photo of a request (Cloudinary and the record), e.g. once the portrait is done. */
export async function deletePhotos(client: Db, commissionId: string): Promise<number> {
  const rows = await client.rows<{ id: string; storage_public_id: string }>`
    select id, storage_public_id from public.commission_files
    where commission_request_id = ${commissionId} and storage_public_id is not null`;
  const config = cloudinary();
  for (const row of rows) {
    await destroyPrivateImage(config, row.storage_public_id);
    await client.run`delete from public.commission_files where id = ${row.id}`;
  }
  return rows.length;
}
