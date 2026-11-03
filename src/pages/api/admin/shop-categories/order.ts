import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { reorderShopCategories } from '@/lib/server/admin/shopCategories';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const orderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict();

/** Save the order the shop shows its categories in. */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { ids } = orderSchema.parse(await request.json());
    await reorderShopCategories(admin.client, ids);
    await audit(admin, 'reorder_shop_categories', 'shop_collections', '', { count: ids.length });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el orden.');
  }
};
