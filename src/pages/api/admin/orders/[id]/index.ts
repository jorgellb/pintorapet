import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';

export const prerender = false;

const patchSchema = z
  .object({
    fulfillmentStatus: z.enum(['unfulfilled', 'preparing', 'shipped', 'completed']),
  })
  .strict();

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = z.string().uuid().parse(params.id);
    const body = patchSchema.parse(await request.json());

    const { data, error } = await admin.client
      .from('orders')
      .update({ fulfillment_status: body.fulfillmentStatus })
      .eq('id', id)
      .eq('payment_status', 'paid')
      .select('id, fulfillment_status')
      .maybeSingle();
    if (error) throw mapPgError(error);
    if (!data) {
      return jsonError(new CommerceError('VALIDATION', 'Only paid orders can be prepared', 409));
    }

    await admin.client.from('admin_audit_log').insert({
      actor_user_id: admin.user.id,
      operation: 'update_order_fulfillment',
      entity_type: 'orders',
      entity_id: id,
      change: body,
    });

    return Response.json({ ok: true, order: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid order patch', 400, err));
    }
    return jsonError(new CommerceError('INTERNAL', 'Order update failed', 500));
  }
};
