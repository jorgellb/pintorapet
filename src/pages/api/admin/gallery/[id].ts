import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { updateGalleryItem } from '@/lib/server/admin/editorial';
import { gallerySchema } from '@/lib/server/admin/editorialSchema';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = params.id;
    if (!id) return jsonError(new CommerceError('VALIDATION', 'Missing gallery id', 400));
    const input = gallerySchema.parse(await request.json());
    await updateGalleryItem(admin.client, id, input);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('VALIDATION', 'Could not save the gallery item', 400));
  }
};
