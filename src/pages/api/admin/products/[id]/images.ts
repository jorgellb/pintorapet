import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { setProductImages } from '@/lib/server/admin/products';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

const bodySchema = z.object({ mediaAssetIds: z.array(z.string().uuid()).max(24) }).strict();

export const PUT: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = z.string().uuid().parse(params.id);
    const body = bodySchema.parse(await request.json());
    await setProductImages(admin.client, id, body.mediaAssetIds);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid photo list', 400, err));
    }
    return jsonError(new CommerceError('INTERNAL', 'Photo update failed', 500));
  }
};
