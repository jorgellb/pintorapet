import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { reorderProductTypes } from '@/lib/server/admin/productTypes';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const orderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict();

/** Save the order of the shop's type filters. */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { ids } = orderSchema.parse(await request.json());
    await reorderProductTypes(admin.client, ids);
    await audit(admin, 'reorder_product_types', 'categories', '', { count: ids.length });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el orden.');
  }
};
