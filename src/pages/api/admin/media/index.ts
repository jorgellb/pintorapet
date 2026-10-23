import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { uploadMedia } from '@/lib/server/admin/editorial';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return jsonError(new CommerceError('VALIDATION', 'Choose an image', 400));
    }
    const row = await uploadMedia(
      admin.client,
      file,
      String(form.get('bucket') ?? 'portfolio-public'),
      String(form.get('altEn') ?? ''),
      String(form.get('altEs') ?? ''),
    );
    return Response.json({ ok: true, media: row });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('INTERNAL', 'Upload failed', 500));
  }
};
