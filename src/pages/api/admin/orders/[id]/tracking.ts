import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { syncOrderTracking } from '@/lib/server/shipping/trackingSync';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Ask Correos where the parcel is, and move the order's state with it. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const result = await syncOrderTracking(admin.client, id);
    if (result.changed) await audit(admin, 'tracking_update', 'orders', id, { status: result.status });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return failure(err, 'No se pudo consultar el seguimiento.');
  }
};
