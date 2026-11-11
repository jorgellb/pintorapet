import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { deleteAbandonedOrders } from '@/lib/server/commerce/orderAdmin';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Delete every order never paid and abandoned (closed over a day ago, or open over two). */
export const DELETE: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const deleted = await deleteAbandonedOrders(admin.client);
    await audit(admin, 'delete_abandoned_orders', 'orders', '', { deleted });
    return Response.json({ ok: true, deleted });
  } catch (err) {
    return failure(err, 'No se pudieron borrar los pedidos abandonados.');
  }
};
