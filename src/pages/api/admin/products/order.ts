import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { reorderProducts } from '@/lib/server/admin/products';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const orderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) }).strict();

/** Save the order of the pieces of one type (Admin › Productos › Tazas ↑↓). */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { ids } = orderSchema.parse(await request.json());
    await reorderProducts(admin.client, ids);
    await audit(admin, 'reorder_products', 'products', '', { count: ids.length });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el orden.');
  }
};
