import type { APIRoute } from 'astro';
import { z } from 'zod';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { serviceDb, type Db } from '@/lib/server/db';
import { openReviewLink, type ReviewOrder } from '@/lib/server/reviews/link';
import { addReviewPhoto, removeReviewPhoto } from '@/lib/server/reviews/photos';

export const prerender = false;

const linkSchema = z.object({ r: z.string().trim().min(3).max(40), k: z.string().trim().min(16).max(128) });

function fail(err: unknown): Response {
  if (err instanceof CommerceError) return jsonError(err);
  if (err && typeof err === 'object' && 'issues' in err) return jsonError(new CommerceError('VALIDATION', 'Invalid upload', 400));
  return internalError(err, 'Upload failed');
}

/** The order the link opens and its review, which must exist and still be the customer's to edit. */
async function editableReview(db: Db, link: { r: string; k: string }): Promise<{ order: ReviewOrder; reviewId: string }> {
  const order = await openReviewLink(db, link.r, link.k);
  // The same answer for an unknown order, a wrong key and an expired link.
  if (!order) throw new CommerceError('FORBIDDEN', 'REVIEW_LINK_INVALID', 403);
  if (!order.review) throw new CommerceError('CONFLICT', 'REVIEW_REQUIRED', 409);
  if (!order.review.editable) throw new CommerceError('CONFLICT', 'REVIEW_CLOSED', 409);
  return { order, reviewId: order.review.id };
}

/** One photo for the customer's review (up to three), sent after the review itself. */
export const POST: APIRoute = async ({ request }) => {
  try {
    const db = serviceDb();
    if (!db) throw new CommerceError('NOT_CONFIGURED', 'Photos are not available', 503);
    const form = await request.formData().catch(() => null);
    if (!form) throw new CommerceError('VALIDATION', 'Invalid upload', 400);
    const link = linkSchema.parse({ r: form.get('r'), k: form.get('k') });
    const file = form.get('file');
    if (!(file instanceof File)) throw new CommerceError('VALIDATION', 'NOT_A_PHOTO', 400);

    const { reviewId } = await editableReview(db, link);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await dbCall(() => addReviewPhoto(db, reviewId, { bytes, contentType: file.type }));
    return Response.json({ ok: true, id: saved.id });
  } catch (err) {
    return fail(err);
  }
};

const removeSchema = linkSchema.extend({ photoId: z.uuid() });

/** Take one of their photos off the review. */
export const DELETE: APIRoute = async ({ request }) => {
  try {
    const db = serviceDb();
    if (!db) throw new CommerceError('NOT_CONFIGURED', 'Photos are not available', 503);
    const body = removeSchema.parse(await request.json().catch(() => null));
    const { reviewId } = await editableReview(db, body);
    await dbCall(() => removeReviewPhoto(db, reviewId, body.photoId));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
};
