import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { deleteShopCategory, shopCategorySchema, updateShopCategory } from '@/lib/server/admin/shopCategories';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const idSchema = z.uuid();

/** Edit a shop category. */
export const PATCH: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = idSchema.parse(params.id);
    const input = shopCategorySchema.parse(await request.json());
    await updateShopCategory(admin.client, id, input);
    await audit(admin, 'update_shop_category', 'shop_collections', id, { code: input.code, published: input.published });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar la categoría.');
  }
};

/** Delete a shop category; its products stay, without a category. */
export const DELETE: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = idSchema.parse(params.id);
    await deleteShopCategory(admin.client, id);
    await audit(admin, 'delete_shop_category', 'shop_collections', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar la categoría.');
  }
};
