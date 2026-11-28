import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { deleteAdminProduct, updateAdminProduct } from '@/lib/server/admin/products';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const translation = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(2000).optional(),
    description: z.string().max(20000).optional(),
    slug: slug.optional(),
    seoTitle: z.string().max(120).optional(),
    seoDescription: z.string().max(320).optional(),
  })
  .optional();

const patchSchema = z
  .object({
    status: z.enum(['draft', 'published', 'archived']).optional(),
    priceCents: z.number().int().positive().optional(),
    saleEnabled: z.boolean().optional(),
    weightGrams: z.number().int().min(1).max(30000).optional(),
    motif: z.string().trim().min(1).max(120).optional(),
    collectionId: z.uuid().nullable().optional(),
    sku: z.string().trim().min(1).max(60).optional(),
    variantLabelEn: z.string().trim().max(80).optional(),
    variantLabelEs: z.string().trim().max(80).optional(),
    expectedUpdatedAt: z.string().min(1).optional(),
    en: translation,
    es: translation,
  })
  .strict();

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) {
      return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    }
    const id = params.id;
    if (!id) {
      return jsonError(new CommerceError('VALIDATION', 'Missing product id', 400));
    }
    const body = patchSchema.parse(await request.json());
    await updateAdminProduct(admin.db, id, body);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid product patch', 400, err),
      );
    }
    return internalError(err, 'Product update failed');
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = z.string().uuid().parse(params.id);
    const result = await deleteAdminProduct(admin.db, id);
    await admin.db
      .run`
        insert into public.admin_audit_log (actor_user_id, operation, entity_type, entity_id)
        values (${admin.user.id}, ${result === 'deleted' ? 'delete_product' : 'archive_product'}, 'products', ${id})`
      .catch(() => 0);
    return Response.json({ ok: true, result });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return internalError(err, 'Product delete failed');
  }
};
