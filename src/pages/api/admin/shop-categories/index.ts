import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { createShopCategory, shopCategorySchema } from '@/lib/server/admin/shopCategories';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Create a shop category. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const input = shopCategorySchema.parse(await request.json());
    const id = await createShopCategory(admin.client, input);
    await audit(admin, 'create_shop_category', 'shop_collections', id, { code: input.code });
    return Response.json({ ok: true, id });
  } catch (err) {
    return failure(err, 'No se pudo crear la categoría.');
  }
};
