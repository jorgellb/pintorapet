import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { deleteProductType, productTypeSchema, updateProductType } from '@/lib/server/admin/productTypes';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const idSchema = z.uuid();

/** Edit a product type (its address stays). */
export const PATCH: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = idSchema.parse(params.id);
    const input = productTypeSchema.parse(await request.json());
    await updateProductType(admin.client, id, input);
    await audit(admin, 'update_product_type', 'categories', id, { published: input.published, vatRate: input.vatRate });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el tipo de producto.');
  }
};

/** Delete a product type that has no products. */
export const DELETE: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = idSchema.parse(params.id);
    await deleteProductType(admin.client, id);
    await audit(admin, 'delete_product_type', 'categories', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el tipo de producto.');
  }
};
