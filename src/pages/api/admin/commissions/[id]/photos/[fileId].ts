import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { photoFile } from '@/lib/server/commissionPhotos';
import { failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** A photo sent with a commission request, for the admin only. */
export const GET: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    return await photoFile(admin.db, z.uuid().parse(params.id), z.uuid().parse(params.fileId));
  } catch (err) {
    return failure(err, 'No se pudo abrir la foto.');
  }
};
