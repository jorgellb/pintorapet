import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { asUser, db } from '@/lib/server/db';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { CommerceError } from '@/lib/server/commerce/errors';
import { reviewPatchSchema } from '@/lib/domain/reviews';
import { deleteReview, forgetReviews, hideReview, publishReview, updateReview } from '@/lib/server/reviews/store';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** The `updated_at` the page showed: publishing and every change send it back. */
const seen = z.string().trim().max(64).refine((value) => !Number.isNaN(Date.parse(value)), 'Fecha no válida');

/** Publishing and changing send back the `updated_at` Meili read; the review may have changed since. */
const patchSchema = z.union([
  z.object({ action: z.literal('publish'), updatedAt: seen }).strict(),
  z.object({ action: z.literal('hide') }).strict(),
  reviewPatchSchema.extend({ updatedAt: seen }),
]);

/** Publish or hide a review, or correct it (name, city, pet, product; everything for Meili's own). */
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    // A body that is not JSON is the sender's mistake: 400, not 500.
    const body = patchSchema.parse(await request.json().catch(() => null));
    if ('action' in body) {
      // The owner's connection: the private photo ids are not readable by the admin role.
      if (body.action === 'publish') {
        await dbCall(() => publishReview(db(), id, body.updatedAt));
        await audit(admin, 'publish_review', 'reviews', id, {});
        return Response.json({ ok: true, id });
      }
      const hidden = await dbCall(() => hideReview(db(), id));
      await audit(admin, 'hide_review', 'reviews', id, hidden.warning ? { leftovers: true } : {});
      return Response.json({ ok: true, id, ...hidden });
    }
    const { updatedAt, ...patch } = body;
    if (Object.keys(patch).length === 0) throw new CommerceError('VALIDATION', 'No hay nada que cambiar.', 400);
    // Refused (409) unless the review is still what the page showed; the new value comes from that same write.
    const saved = await dbCall(() => asUser(admin.user.id, (tx) => updateReview(tx, id, patch, updatedAt)));
    forgetReviews();
    await audit(admin, 'update_review', 'reviews', id, patch);
    return Response.json({ ok: true, id, updatedAt: saved });
  } catch (err) {
    return failure(err, 'No se pudo cambiar la opinión.');
  }
};

/** Delete a review and all its photos (the private and the public copies). */
export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    await dbCall(() => deleteReview(db(), id));
    await audit(admin, 'delete_review', 'reviews', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar la opinión.');
  }
};
