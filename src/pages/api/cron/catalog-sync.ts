import type { APIRoute } from 'astro';
import { syncShopCatalog } from '@/lib/catalog/syncCatalog';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return jsonError(new CommerceError('FORBIDDEN', 'Unauthorized cron', 401));
  }
  const result = await syncShopCatalog();
  const ok = (!result.google.configured || result.google.ok) && (!result.meta.configured || result.meta.ok);
  return Response.json({ ok, ...result }, { status: ok ? 200 : 502 });
};
