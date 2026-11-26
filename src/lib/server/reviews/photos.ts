import { randomUUID } from 'node:crypto';
import { transaction, type Db } from '@/lib/server/db';
import { MAX_PHOTO_BYTES, photoType } from '@/lib/server/commissionPhotos';
import {
  destroyImage,
  destroyPrivateImage,
  parseCloudinaryUrl,
  privateDownloadUrl,
  uploadImage,
  uploadPrivateImage,
} from '@/lib/server/media/cloudinary';
import { CommerceError } from '@/lib/server/commerce/errors';
import { REVIEW_MAX_PHOTOS } from '@/lib/domain/reviews';

/**
 * The photos of a review. A customer's are private in Cloudinary until Meili
 * publishes the review; then a public copy is made under `reviews/` (not in
 * Medios, so nobody deletes it by mistake). Hiding takes the public copy down
 * and keeps the private one.
 *
 * These functions read `private_public_id`, which the API roles cannot select
 * (see the reviews migration): pass the service db, never `admin.db`.
 */

type Deps = { fetchImpl?: typeof fetch };

function cloudinary() {
  const config = parseCloudinaryUrl(import.meta.env.CLOUDINARY_URL);
  if (!config) throw new CommerceError('NOT_CONFIGURED', 'Photo storage is not configured', 503);
  return config;
}

type PhotoRow = {
  id: string;
  private_public_id: string | null;
  public_public_id: string | null;
};

const photosOf = (db: Db, reviewId: string) =>
  db.rows<PhotoRow>`
    select id, private_public_id, public_public_id from public.review_photos
    where review_id = ${reviewId} order by position`;

/**
 * Keep one photo a customer sent. Refused unless the review is theirs to edit
 * (pending and untouched). The slot is taken first, with the review row locked,
 * so uploads that arrive together cannot pass the cap; it is given back if
 * the upload to Cloudinary fails.
 */
export async function addReviewPhoto(
  db: Db,
  reviewId: string,
  file: { bytes: Uint8Array<ArrayBuffer>; contentType: string },
  { fetchImpl }: Deps = {},
): Promise<{ id: string }> {
  if (file.bytes.byteLength <= 0 || file.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new CommerceError('VALIDATION', 'PHOTO_TOO_LARGE', 400);
  }
  // What the file is, not what it says it is.
  const type = photoType(file.bytes);
  if (!type) throw new CommerceError('VALIDATION', 'NOT_A_PHOTO', 400);
  const config = cloudinary();

  const id = randomUUID();
  const publicId = `reviews-private/${reviewId}/${id}`;
  await transaction(async (tx) => {
    const review = await tx.one<{ source: string; status: string; admin_edited_at: string | null }>`
      select source, status, admin_edited_at from public.reviews where id = ${reviewId} for update`;
    if (!review || review.source !== 'customer' || review.status !== 'pending' || review.admin_edited_at) {
      throw new CommerceError('CONFLICT', 'REVIEW_CLOSED', 409);
    }
    const taken = await tx.rows<{ position: number }>`
      select position from public.review_photos where review_id = ${reviewId}`;
    if (taken.length >= REVIEW_MAX_PHOTOS) throw new CommerceError('VALIDATION', 'TOO_MANY_PHOTOS', 400);
    const used = new Set(taken.map((p) => p.position));
    const position = [0, 1, 2].find((p) => !used.has(p)) ?? taken.length;
    await tx.run`
      insert into public.review_photos (id, review_id, position, private_public_id, bytes)
      values (${id}, ${reviewId}, ${position}, ${publicId}, ${file.bytes.byteLength})`;
  });

  try {
    await uploadPrivateImage(config, { bytes: file.bytes, contentType: type, publicId }, { fetchImpl });
  } catch (err) {
    await db.run`delete from public.review_photos where id = ${id}`.catch(() => 0);
    throw err;
  }
  return { id };
}

/**
 * Take one photo off a review the customer may still edit. The review row is
 * locked and checked again inside the transaction (so Meili publishing or
 * editing at the same moment wins or waits), the photo row goes, and only then
 * the file in Cloudinary. A file that cannot be destroyed is private and no
 * longer tied to the review: it is logged for cleaning, not shown as a failure.
 */
export async function removeReviewPhoto(_db: Db, reviewId: string, photoId: string, { fetchImpl }: Deps = {}): Promise<void> {
  const config = cloudinary();
  const photo = await transaction(async (tx) => {
    const review = await tx.one<{ source: string; status: string; admin_edited_at: string | null }>`
      select source, status, admin_edited_at from public.reviews where id = ${reviewId} for update`;
    if (!review) throw new CommerceError('UNAVAILABLE', 'PHOTO_NOT_FOUND', 404);
    if (review.source !== 'customer' || review.status !== 'pending' || review.admin_edited_at) {
      throw new CommerceError('CONFLICT', 'REVIEW_CLOSED', 409);
    }
    const row = await tx.one<PhotoRow>`
      delete from public.review_photos where id = ${photoId} and review_id = ${reviewId}
      returning id, private_public_id, public_public_id`;
    if (!row) throw new CommerceError('UNAVAILABLE', 'PHOTO_NOT_FOUND', 404);
    return row;
  });
  if (!photo.private_public_id) return;
  await destroyPrivateImage(config, photo.private_public_id, { fetchImpl }).catch((err: unknown) => {
    console.error('[reviews] removed photo left in Cloudinary', photo.private_public_id, err instanceof Error ? err.message : err);
  });
}

/**
 * Meili drops one photo of any review (a customer's, pending or published). Both
 * copies are destroyed first, then the row: if Cloudinary fails the row stays and
 * she can press again. Deleting the row moves the review's `updated_at` (the
 * photo trigger), so the page must reload before it can publish. `db` is the
 * service db; the pair must match, or it is a 404.
 */
export async function removeReviewPhotoAsAdmin(db: Db, reviewId: string, photoId: string, { fetchImpl }: Deps = {}): Promise<void> {
  const photo = await db.one<PhotoRow>`
    select id, private_public_id, public_public_id from public.review_photos where id = ${photoId} and review_id = ${reviewId}`;
  if (!photo) throw new CommerceError('UNAVAILABLE', 'Foto no encontrada.', 404);
  if (photo.public_public_id || photo.private_public_id) {
    const config = cloudinary();
    try {
      if (photo.public_public_id) await destroyImage(config, photo.public_public_id, { fetchImpl });
      if (photo.private_public_id) await destroyPrivateImage(config, photo.private_public_id, { fetchImpl });
    } catch (err) {
      console.error('[reviews] photo not removed: Cloudinary failed', photoId, err instanceof Error ? err.message : err);
      throw new CommerceError('UNAVAILABLE', 'Cloudinary no pudo borrar la foto; sigue en la opinión. Vuelve a intentarlo.', 502);
    }
  }
  await db.run`delete from public.review_photos where id = ${photoId} and review_id = ${reviewId}`;
}

/**
 * Make the photos of a review public: each private image is downloaded through a
 * signed, short-lived link and uploaded again as `reviews/<review>/<photo>-<seconds>`.
 * The copy's id is written to the row BEFORE the upload: a retry after any
 * failure reuses it (the upload does not overwrite, so an image already there
 * simply comes back), and no copy can exist that the row does not know about.
 * The name ends with the time: publishing again after a hide (which clears the
 * id) must not reuse the id of a destroyed image, whose 404 the CDN may still hold.
 */
export async function publishPhotos(db: Db, reviewId: string, { fetchImpl = fetch }: Deps = {}): Promise<void> {
  const config = cloudinary();
  for (const photo of await photosOf(db, reviewId)) {
    if (!photo.private_public_id) continue;
    const intended = `reviews/${reviewId}/${photo.id}-${Math.floor(Date.now() / 1000)}`;
    // Keeps an id already written (an earlier attempt): never a second copy of one photo.
    const named = await db.one<{ public_public_id: string }>`
      update public.review_photos set public_public_id = coalesce(public_public_id, ${intended})
      where id = ${photo.id} returning public_public_id`;
    if (!named) continue;
    const download = await fetchImpl(privateDownloadUrl(config, photo.private_public_id, { ttlSeconds: 120 }));
    if (download.status === 404) {
      // The private image is gone (already deleted): drop the photo instead of blocking the review forever.
      console.error('[reviews] private photo missing, dropped', photo.id);
      await db.run`delete from public.review_photos where id = ${photo.id}`;
      continue;
    }
    if (!download.ok) throw new CommerceError('UNAVAILABLE', 'Cloudinary no devolvió la foto.', 502);
    const bytes = new Uint8Array(await download.arrayBuffer());
    await uploadImage(config, { bytes, contentType: 'image/jpeg', publicId: named.public_public_id }, { fetchImpl });
  }
}

/**
 * Take the public copies down (the private originals stay) so their URLs stop
 * serving. Every copy is tried; one that fails keeps its id on the row for the
 * next try, and the whole call then throws.
 */
export async function unpublishPhotos(db: Db, reviewId: string, { fetchImpl }: Deps = {}): Promise<void> {
  const photos = (await photosOf(db, reviewId)).filter((photo) => photo.public_public_id);
  if (photos.length === 0) return;
  const config = cloudinary();
  let failed: unknown = null;
  for (const photo of photos) {
    try {
      await destroyImage(config, photo.public_public_id!, { fetchImpl });
      await db.run`update public.review_photos set public_public_id = null where id = ${photo.id}`;
    } catch (err) {
      failed ??= err;
    }
  }
  if (failed) throw failed;
}

/**
 * Delete every file of a review, private and public, and the photo rows. Every
 * photo is tried; a row whose files could not all be destroyed stays, with its
 * ids, for the next try, and the whole call then throws.
 */
export async function purgePhotos(db: Db, reviewId: string, { fetchImpl }: Deps = {}): Promise<void> {
  const photos = await photosOf(db, reviewId);
  if (photos.length === 0) return;
  const config = cloudinary();
  let failed: unknown = null;
  for (const photo of photos) {
    try {
      if (photo.public_public_id) await destroyImage(config, photo.public_public_id, { fetchImpl });
      if (photo.private_public_id) await destroyPrivateImage(config, photo.private_public_id, { fetchImpl });
      await db.run`delete from public.review_photos where id = ${photo.id}`;
    } catch (err) {
      failed ??= err;
    }
  }
  if (failed) throw failed;
}

/** A customer's private photo, for Admin (fetched through a signed, short-lived link). */
export async function reviewPhotoFile(db: Db, reviewId: string, photoId: string, { fetchImpl = fetch }: Deps = {}): Promise<Response> {
  const row = await db.one<{ private_public_id: string | null }>`
    select private_public_id from public.review_photos where id = ${photoId} and review_id = ${reviewId}`;
  if (!row?.private_public_id) throw new CommerceError('UNAVAILABLE', 'Foto no encontrada.', 404);
  const res = await fetchImpl(privateDownloadUrl(cloudinary(), row.private_public_id, { ttlSeconds: 120 }));
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
