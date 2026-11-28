import type { APIRoute } from 'astro';
import { z } from 'zod';
import { addPhoto } from '@/lib/server/commissionPhotos';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { serviceDb } from '@/lib/server/db';

export const prerender = false;

const fieldsSchema = z.object({
  reference: z.string().regex(/^CR-[A-Z0-9]{10}$/),
  token: z.string().min(16).max(128),
});

/** One photo of the pet for a request just sent (the form's upload key is required). */
export const POST: APIRoute = async ({ request }) => {
  try {
    const db = serviceDb();
    if (!db) throw new CommerceError('NOT_CONFIGURED', 'Photos are not available', 503);
    const form = await request.formData().catch(() => null);
    if (!form) throw new CommerceError('VALIDATION', 'Invalid upload', 400);
    const fields = fieldsSchema.parse({ reference: form.get('reference'), token: form.get('token') });
    const file = form.get('photo');
    if (!(file instanceof File)) throw new CommerceError('VALIDATION', 'NOT_A_PHOTO', 400);
    const saved = await addPhoto(db, { ...fields, file });
    return Response.json({ ok: true, count: saved.count });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) return jsonError(new CommerceError('VALIDATION', 'Invalid upload', 400));
    return internalError(err, 'Upload failed');
  }
};
