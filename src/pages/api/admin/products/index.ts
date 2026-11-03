import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { createAdminProduct, setProductCollection } from '@/lib/server/admin/products';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const copy = z.object({
  title: z.string().trim().min(1).max(200),
  slug,
  summary: z.string().max(2000).optional(),
  description: z.string().max(20000).optional(),
});

const createSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    categoryCode: z.string().trim().min(1).max(60).optional(),
    collectionId: z.uuid().nullable().optional(),
    motif: z.string().trim().min(1).max(120).optional(),
    sku: z.string().trim().min(1).max(60),
    priceCents: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    variantLabelEn: z.string().trim().max(80).optional(),
    variantLabelEs: z.string().trim().max(80).optional(),
    en: copy,
    es: copy,
  })
  .strict()
  .refine((body) => body.parentId || (body.categoryCode && body.motif), {
    message: 'A new product needs a category and a motif',
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const body = createSchema.parse(await request.json());
    const { collectionId, ...product } = body;
    const id = await createAdminProduct(admin.client, product);
    // Variations follow their product's shop category.
    if (body.parentId) {
      const { data: parent } = await admin.client.from('products').select('collection_id').eq('id', body.parentId).maybeSingle();
      if (parent?.collection_id) await setProductCollection(admin.client, id, parent.collection_id);
    } else if (collectionId) {
      await setProductCollection(admin.client, id, collectionId);
    }
    await admin.client.from('admin_audit_log').insert({
      actor_user_id: admin.user.id,
      operation: body.parentId ? 'create_variant' : 'create_product',
      entity_type: 'products',
      entity_id: id,
      change: { sku: body.sku, parentId: body.parentId ?? null },
    });
    return Response.json({ ok: true, id });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid product', 400, err));
    }
    return jsonError(new CommerceError('INTERNAL', 'Product create failed', 500));
  }
};
