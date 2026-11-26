import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { createManualOrder, manualOrderSchema } from '@/lib/server/commerce/manualOrders';
import { sendOrderEmails } from '@/lib/server/commerce/outbox';
import { serviceDb } from '@/lib/server/db';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** An order taken by phone, paid by bank transfer (now or when it arrives). */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const input = manualOrderSchema.parse(await request.json());
    const created = await createManualOrder(admin.db, input);
    await audit(admin, 'create_manual_order', 'orders', created.orderId, {
      reference: created.reference,
      paid: input.paid,
      method: input.method,
      lines: input.lines.length,
      shippingByHand: input.shippingCents !== null,
    });
    if (input.paid) {
      const service = serviceDb();
      if (service) await sendOrderEmails(service, created.orderId);
    }
    return Response.json({ ok: true, ...created });
  } catch (err) {
    return failure(err, 'No se pudo crear el pedido.');
  }
};
