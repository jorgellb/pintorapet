import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { sendOrderEmails } from '@/lib/server/commerce/outbox';
import { refundRequestSchema, retryRefund, startRefund, type RefundOutcome } from '@/lib/server/commerce/refunds';
import { createServiceClient } from '@/lib/server/supabase';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** The customer's email goes out now, like the other order emails (the cron is the safety net). */
async function tellCustomer(orderId: string, outcome: RefundOutcome) {
  if (outcome.status !== 'succeeded') return;
  const service = createServiceClient();
  if (service) await sendOrderEmails(service, orderId);
}

/** Pay money back (or record money paid back from Stripe/PayPal). */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const input = refundRequestSchema.parse(await request.json());
    const outcome = await startRefund(admin.client, id, input);
    await audit(admin, input.manual ? 'record_refund' : 'refund_order', 'orders', id, {
      refundId: outcome.refundId,
      amountCents: outcome.amountCents,
      status: outcome.status,
      restock: input.restock,
    });
    await tellCustomer(id, outcome);
    return Response.json({ ok: outcome.status !== 'failed', ...outcome }, { status: outcome.status === 'failed' ? 502 : 200 });
  } catch (err) {
    return failure(err, 'No se pudo hacer la devolución.');
  }
};

const retrySchema = z.object({ refundId: z.uuid() }).strict();

/** Ask Stripe/PayPal again about a refund whose answer was lost (same key: never twice). */
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const { refundId } = retrySchema.parse(await request.json());
    const outcome = await retryRefund(admin.client, refundId);
    await audit(admin, 'retry_refund', 'orders', id, { refundId, status: outcome.status });
    await tellCustomer(id, outcome);
    return Response.json({ ok: outcome.status !== 'failed', ...outcome }, { status: outcome.status === 'failed' ? 502 : 200 });
  } catch (err) {
    return failure(err, 'No se pudo reintentar la devolución.');
  }
};
