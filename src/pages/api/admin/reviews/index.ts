import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { asUser, db } from '@/lib/server/db';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { CommerceError } from '@/lib/server/commerce/errors';
import { adminReviewSchema } from '@/lib/domain/reviews';
import { createAdminReview, forgetReviews, publishReview } from '@/lib/server/reviews/store';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Meili's own review ("Nueva opinión"): photos from Medios, never "Compra verificada". */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    // A body that is not JSON is the sender's mistake: 400, not 500.
    const parsed = adminReviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Revisa los datos de la opinión.' } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const id = await dbCall(() => asUser(admin.user.id, (tx) => createAdminReview(tx, input)));
    forgetReviews();
    await audit(admin, 'create_review', 'reviews', id, { publish: input.publish });
    if (!input.publish) return Response.json({ ok: true, id });

    // Saved either way: if only the publishing fails, answer with the id (a retry
    // would otherwise create the review twice) and let Meili publish it from the list.
    try {
      // The owner's connection reads the photos' private ids, which the admin role cannot.
      const saved = await db().one<{ updated_at: string }>`select updated_at from public.reviews where id = ${id}`;
      await dbCall(() => publishReview(db(), id, saved!.updated_at));
    } catch (err) {
      console.error('[admin review] saved but not published', id, err);
      const reason = err instanceof CommerceError ? err.message : 'error inesperado';
      return Response.json({ ok: true, id, published: false, warning: `Guardada, pero no se pudo publicar: ${reason}` });
    }
    // Outside the try: a failing audit line must not say the publishing failed.
    await audit(admin, 'publish_review', 'reviews', id, {}).catch((err: unknown) => console.error('[admin review] audit not recorded', err));
    return Response.json({ ok: true, id, published: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar la opinión.');
  }
};
