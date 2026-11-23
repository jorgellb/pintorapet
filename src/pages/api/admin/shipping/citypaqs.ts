import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { findCitypaqs } from '@/lib/server/shipping/admin';
import { failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const querySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[\p{L}\d .'-]+$/u);

/** Public Citypaq lockers for a postal code or a town. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const lockers = await findCitypaqs(querySchema.parse(url.searchParams.get('q') ?? ''));
    return Response.json({ ok: true, lockers });
  } catch (err) {
    return failure(err, 'No se pudieron buscar las taquillas.');
  }
};
