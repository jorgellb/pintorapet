import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { db } from '@/lib/server/db';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { removeReviewPhotoAsAdmin, reviewPhotoFile } from '@/lib/server/reviews/photos';
import { forgetReviews } from '@/lib/server/reviews/store';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** A photo a customer sent with a review, for the admin only (the private copy, read through a signed link). */
export const GET: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    // The owner's connection: the private photo ids are not readable by the admin role.
    return await reviewPhotoFile(db(), z.uuid().parse(params.id), z.uuid().parse(params.photoId));
  } catch (err) {
    return failure(err, 'No se pudo abrir la foto.');
  }
};

/**
 * Meili drops one photo of a review: both copies in Cloudinary, then the row.
 * That moves the review's `updated_at`, so the page reloads before it can publish.
 */
export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const photoId = z.uuid().parse(params.photoId);
    // The owner's connection: the private photo ids are not readable by the admin role.
    await dbCall(() => removeReviewPhotoAsAdmin(db(), id, photoId));
    forgetReviews();
    await audit(admin, 'remove_review_photo', 'reviews', id, { photoId });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo quitar la foto.');
  }
};
