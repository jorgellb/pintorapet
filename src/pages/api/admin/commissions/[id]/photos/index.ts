import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { deletePhotos } from '@/lib/server/commissionPhotos';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Delete the pet's photos of a request (once the portrait no longer needs them). */
export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const deleted = await deletePhotos(admin.db, id);
    await audit(admin, 'delete_commission_photos', 'commission_requests', id, { deleted });
    return Response.json({ ok: true, deleted });
  } catch (err) {
    return failure(err, 'No se pudieron borrar las fotos.');
  }
};
