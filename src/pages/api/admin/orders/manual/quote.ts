import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { manualOrderSchema, quoteManualOrder } from '@/lib/server/commerce/manualOrders';
import { failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** What a phone order would cost: prices, shipping and total, as the web would charge them. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const input = manualOrderSchema.parse(await request.json());
    return Response.json({ ok: true, quote: await quoteManualOrder(admin.db, input) });
  } catch (err) {
    return failure(err, 'No se pudo calcular el pedido.');
  }
};
