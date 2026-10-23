import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { createArtwork } from '@/lib/server/admin/editorial';
import { artworkSchema } from '@/lib/server/admin/editorialSchema';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const input = artworkSchema.parse(await request.json());
    const id = await createArtwork(admin.client, input);
    return Response.json({ ok: true, id });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('VALIDATION', 'Could not create the artwork', 400));
  }
};
