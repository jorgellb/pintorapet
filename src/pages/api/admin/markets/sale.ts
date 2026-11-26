import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { marketSaleSchema, sellAtStall } from '@/lib/server/commerce/marketSales';
import { sendOrderEmails } from '@/lib/server/commerce/outbox';
import { serviceDb } from '@/lib/server/db';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** A sale at the stall: paid, handed over, stock out at once. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const input = marketSaleSchema.parse(await request.json());
    const sale = await sellAtStall(admin.db, input);
    await audit(admin, 'market_sale', 'orders', sale.orderId, {
      reference: sale.reference,
      method: input.method,
      marketId: input.marketId,
      totalCents: sale.totalCents,
    });
    if (input.customer.email) {
      const service = serviceDb();
      if (service) await sendOrderEmails(service, sale.orderId);
    }
    return Response.json({ ok: true, ...sale });
  } catch (err) {
    return failure(err, 'No se pudo registrar la venta.');
  }
};
