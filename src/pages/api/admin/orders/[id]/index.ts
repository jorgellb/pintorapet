import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { cancelOrder, deleteOrder } from '@/lib/server/commerce/orderAdmin';
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
]);

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const body = patchSchema.parse(await request.json());

    if ('fulfillmentStatus' in body) {
      const { data, error } = await admin.client
        .from('orders')
        .update({ fulfillment_status: body.fulfillmentStatus })
        .eq('id', id)
        // A partly refunded order still has pieces to send.
        .in('payment_status', ['paid', 'partially_refunded'])
        .select('id, fulfillment_status')
        .maybeSingle();
      if (error) throw mapPgError(error);
      if (!data) throw new CommerceError('VALIDATION', 'El envío solo se cambia en pedidos pagados.', 409);
      await audit(admin, 'update_order_fulfillment', 'orders', id, body);
      return Response.json({ ok: true, order: data });
    }

    if ('archived' in body) {
      const { error } = await admin.client.rpc('admin_set_order_archived', { p_order_id: id, p_archived: body.archived });
      if (error) throw mapPgError(error);
      await audit(admin, body.archived ? 'archive_order' : 'unarchive_order', 'orders', id, {});
      return Response.json({ ok: true });
    }

    await cancelOrder(admin.client, id);
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
    const { data: order } = await admin.client.from('orders').select('reference').eq('id', id).maybeSingle();
    await deleteOrder(admin.client, id);
    await audit(admin, 'delete_order', 'orders', id, { reference: order?.reference ?? null });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el pedido.');
  }
};
