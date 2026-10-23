import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { testCorreosConnection } from '@/lib/server/shipping/admin';
import { failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    await testCorreosConnection();
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo comprobar Correos.');
  }
};
