import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { createProductType, newProductTypeSchema } from '@/lib/server/admin/productTypes';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Create a product type. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const input = newProductTypeSchema.parse(await request.json());
    const id = await createProductType(admin.client, input);
    await audit(admin, 'create_product_type', 'categories', id, { code: input.code });
    return Response.json({ ok: true, id });
  } catch (err) {
    return failure(err, 'No se pudo crear el tipo de producto.');
  }
};
