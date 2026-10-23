import type { APIRoute } from 'astro';
import { syncShopCatalog } from '@/lib/catalog/syncCatalog';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
  const result = await syncShopCatalog();
  const ok = (!result.google.configured || result.google.ok) && (!result.meta.configured || result.meta.ok);
  return Response.json({ ok, ...result }, { status: ok ? 200 : 502 });
};
