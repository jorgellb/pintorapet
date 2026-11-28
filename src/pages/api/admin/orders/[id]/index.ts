import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { cancelOrder, deleteOrder, markOrderPaid } from '@/lib/server/commerce/orderAdmin';
import { sendOrderEmails } from '@/lib/server/commerce/outbox';
import { serviceDb } from '@/lib/server/db';
import { FULFILLMENT_STATES } from '@/lib/server/shipping/tracking';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const patchSchema = z.union([
  /** The shipping state, by hand (paid or partly refunded orders). */
  z.object({ fulfillmentStatus: z.enum(FULFILLMENT_STATES) }).strict(),
  /** Out of the list, or back. */
  z.object({ archived: z.boolean() }).strict(),
  /** An order never paid: cancelled (its stock freed, its checkout closed). */
  z.object({ cancel: z.literal(true) }).strict(),
  /** The bank transfer arrived. */
  z.object({ markPaid: z.literal(true) }).strict(),
  /** A payment under review: taken as good (paid), or cancelled (to refund from Stripe or PayPal). */
  z.object({ review: z.enum(['confirm', 'cancel']) }).strict(),
]);

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const body = patchSchema.parse(await request.json());

    if ('fulfillmentStatus' in body) {
      // A partly refunded order still has pieces to send.
      const data = await dbCall(() => admin.db.one`
        update public.orders set fulfillment_status = ${body.fulfillmentStatus}::public.order_fulfillment_status
        where id = ${id} and payment_status in ('paid', 'partially_refunded')
        returning id, fulfillment_status`);
      if (!data) throw new CommerceError('VALIDATION', 'El envío solo se cambia en pedidos pagados.', 409);
      await audit(admin, 'update_order_fulfillment', 'orders', id, body);
      return Response.json({ ok: true, order: data });
    }

    if ('archived' in body) {
      await dbCall(() => admin.db.call('admin_set_order_archived', { p_order_id: id, p_archived: body.archived }));
      await audit(admin, body.archived ? 'archive_order' : 'unarchive_order', 'orders', id, {});
      return Response.json({ ok: true });
    }

    if ('markPaid' in body) {
      await markOrderPaid(admin.db, id);
      const how = await admin.db.one<{ payment_provider: string }>`select payment_provider from public.orders where id = ${id}`;
      await audit(admin, 'mark_order_paid', 'orders', id, { by: how?.payment_provider ?? 'transfer' });
      const service = serviceDb();
      if (service) await sendOrderEmails(service, id);
      return Response.json({ ok: true });
    }

    if ('review' in body) {
      await dbCall(() => admin.db.call('admin_resolve_payment_review', { p_order_id: id, p_action: body.review }));
      const service = serviceDb();
      if (service && body.review === 'confirm') await sendOrderEmails(service, id);
      return Response.json({ ok: true });
    }

    await cancelOrder(admin.db, id);
    await audit(admin, 'cancel_order', 'orders', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo cambiar el pedido.');
  }
};

/** Delete an order that was never paid (cancelling it first if it is still open). */
export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const order = await admin.db.one<{ reference: string }>`select reference from public.orders where id = ${id}`;
    await deleteOrder(admin.db, id);
    await audit(admin, 'delete_order', 'orders', id, { reference: order?.reference ?? null });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el pedido.');
  }
};
