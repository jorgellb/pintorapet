import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { deleteMedia, saveMediaAlts } from '@/lib/server/admin/editorial';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

const patchSchema = z.object({
  altEn: z.string().max(500),
  altEs: z.string().max(500),
});

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = params.id;
    if (!id) return jsonError(new CommerceError('VALIDATION', 'Missing media id', 400));
    const body = patchSchema.parse(await request.json());
    await saveMediaAlts(admin.client, id, body.altEn, body.altEs);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('VALIDATION', 'Could not update the media text', 400));
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = params.id;
    if (!id) return jsonError(new CommerceError('VALIDATION', 'Missing media id', 400));
    await deleteMedia(admin.client, id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('INTERNAL', 'Could not delete the media', 500));
  }
};
