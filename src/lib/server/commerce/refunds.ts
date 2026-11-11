import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CommerceError } from './errors';
import { mapPgError } from './pgErrors';

/**
 * Refunds (Admin › Pedidos › Devolver dinero). The database decides what can be
 * refunded and keeps the books (admin_begin_refund / admin_complete_refund /
 * admin_fail_refund, see supabase/migrations/20261111000002_refunds.sql); this
 * module pays the money back through Stripe or PayPal in between.
 *
 * The refund's id is the idempotency key with both: asking again after a lost
 * answer returns the same refund, never a second one.
 */

export const refundRequestSchema = z
  .object({
    items: z
      .array(z.object({ orderItemId: z.uuid(), quantity: z.number().int().min(0).max(9999) }).strict())
      .max(200),
    shipping: z.boolean(),
    restock: z.boolean(),
    reason: z.string().trim().max(300).default(''),
    /** Already paid back from the Stripe or PayPal dashboard: only record it. */
    manual: z.boolean().default(false),
  })
  .strict();

export type RefundRequest = z.infer<typeof refundRequestSchema>;

/** What Stripe or PayPal answered: done (ok) or refused for good (with why). */
export type ProviderRefund = { id: string; ok: boolean; message?: string };

/** The answer was lost (network, timeout, 5xx): the refund may or may not exist. */
export class ProviderUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnreachable';
  }
}

type PayBack = (paymentRef: string, cents: number, refundId: string, orderId: string) => Promise<ProviderRefund>;
export type RefundProviders = { stripe: PayBack; paypal: PayBack };

export type RefundOutcome = {
  refundId: string;
  amountCents: number;
  status: 'succeeded' | 'failed' | 'pending';
  message?: string;
};

const euros = (cents: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100).replace(/ /g, ' ');

/** The database's refusals, as Meili should read them. */
function explain(err: unknown): CommerceError {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  const mismatch = /REFUND_AMOUNT_MISMATCH:\s*(\d+)/.exec(message);
  if (mismatch) {
    return new CommerceError(
      'VALIDATION',
      `Desde Stripe o PayPal se devolvieron ${euros(Number(mismatch[1]))}. Elige las piezas que suman ese importe.`,
      409,
    );
  }
  const known: Array<[string, string, number]> = [
    ['REFUND_TOO_MUCH', 'No queda tanto por devolver en este pedido.', 409],
    ['REFUND_IN_PROGRESS', 'Ya hay una devolución en curso en este pedido. Espera a que termine o reinténtala.', 409],
    ['REFUND_EMPTY', 'Elige al menos una pieza o el envío.', 400],
    ['REFUND_NOT_PAID', 'Solo se puede devolver el dinero de un pedido pagado.', 409],
    [
      'REFUND_NO_PAYMENT',
      'No consta el pago en Stripe ni en PayPal. Si ya devolviste el dinero por otro lado, márcalo como «Ya lo devolví».',
      409,
    ],
    ['REFUND_INVALID', 'Revisa las piezas de la devolución.', 400],
    ['ORDER_NOT_FOUND', 'Ese pedido no existe.', 404],
  ];
  const hit = known.find(([code]) => message.includes(code));
  return hit ? new CommerceError('VALIDATION', hit[1], hit[2]) : mapPgError(err);
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw explain(error);
  return data as T;
}

/** Ask Stripe/PayPal, then close the refund as done or failed; a lost answer leaves it pending. */
async function payBack(
  client: SupabaseClient,
  refund: { refundId: string; amountCents: number; orderId: string; provider: string; paymentRef: string },
  providers: RefundProviders,
): Promise<RefundOutcome> {
  const pay = refund.provider === 'paypal' ? providers.paypal : providers.stripe;
  let answer: ProviderRefund;
  try {
    answer = await pay(refund.paymentRef, refund.amountCents, refund.refundId, refund.orderId);
  } catch (err) {
    if (err instanceof ProviderUnreachable) {
      return {
        refundId: refund.refundId,
        amountCents: refund.amountCents,
        status: 'pending',
        message: 'No llegó la respuesta de ' + (refund.provider === 'paypal' ? 'PayPal' : 'Stripe') + '. Reinténtalo: no se devolverá dos veces.',
      };
    }
    throw err;
  }
  if (!answer.ok) {
    const message = answer.message || 'La devolución fue rechazada.';
    await rpc(client, 'admin_fail_refund', { p_refund_id: refund.refundId, p_error: message });
    return { refundId: refund.refundId, amountCents: refund.amountCents, status: 'failed', message };
  }
  await rpc(client, 'admin_complete_refund', { p_refund_id: refund.refundId, p_provider_refund_id: answer.id });
  return { refundId: refund.refundId, amountCents: refund.amountCents, status: 'succeeded' };
}

export async function startRefund(
  client: SupabaseClient,
  orderId: string,
  input: RefundRequest,
  providers: RefundProviders = defaultProviders,
): Promise<RefundOutcome> {
  const begun = await rpc<{
    refund_id: string;
    amount_cents: number;
    status: 'pending' | 'succeeded';
    provider?: string;
    payment_ref?: string;
  }>(client, 'admin_begin_refund', {
    p_order_id: orderId,
    p_items: input.items
      .filter((item) => item.quantity > 0)
      .map((item) => ({ order_item_id: item.orderItemId, quantity: item.quantity })),
    p_shipping: input.shipping,
    p_restock: input.restock,
    p_reason: input.reason,
    p_manual: input.manual,
  });
  if (begun.status === 'succeeded') {
    return { refundId: begun.refund_id, amountCents: begun.amount_cents, status: 'succeeded' };
  }
  return payBack(
    client,
    {
      refundId: begun.refund_id,
      amountCents: begun.amount_cents,
      orderId,
      provider: begun.provider ?? 'stripe',
      paymentRef: begun.payment_ref ?? '',
    },
    providers,
  );
}

/** A refund left pending (lost answer): ask again with the same key. */
export async function retryRefund(
  client: SupabaseClient,
  refundId: string,
  providers: RefundProviders = defaultProviders,
): Promise<RefundOutcome> {
  const { data, error } = await client
    .from('order_refunds')
    .select('id, order_id, status, channel, provider, amount_cents, orders(stripe_payment_intent_id, paypal_capture_id)')
    .eq('id', refundId)
    .maybeSingle();
  if (error) throw mapPgError(error);
  const row = data as {
    id: string;
    order_id: string;
    status: string;
    channel: string;
    provider: string | null;
    amount_cents: number;
    orders: { stripe_payment_intent_id: string | null; paypal_capture_id: string | null } | null;
  } | null;
  if (!row || row.status !== 'pending' || row.channel !== 'api') {
    throw new CommerceError('VALIDATION', 'Esa devolución ya no está en curso.', 409);
  }
  const provider = row.provider ?? 'stripe';
  return payBack(
    client,
    {
      refundId: row.id,
      amountCents: row.amount_cents,
      orderId: row.order_id,
      provider,
      paymentRef: (provider === 'paypal' ? row.orders?.paypal_capture_id : row.orders?.stripe_payment_intent_id) ?? '',
    },
    providers,
  );
}

// --- Stripe and PayPal -------------------------------------------------------

export const defaultProviders: RefundProviders = {
  async stripe(paymentIntent, cents, refundId, orderId) {
    const [{ getStripe }, { default: Stripe }] = await Promise.all([import('./stripeClient'), import('stripe')]);
    const stripe = await getStripe();
    if (!stripe) return { id: '', ok: false, message: 'Stripe no está conectado.' };
    try {
      // Stripe forgets idempotency keys after 24 h: a late retry first looks for
      // a refund already made with this id, so it is never paid back twice.
      const earlier = await stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 });
      const mine = earlier.data.find((r) => r.metadata?.refund_id === refundId && r.status !== 'failed' && r.status !== 'canceled');
      if (mine) return { id: mine.id, ok: true };
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: cents,
          reason: 'requested_by_customer',
          metadata: { refund_id: refundId, order_id: orderId },
        },
        { idempotencyKey: `pd-refund-${refundId}` },
      );
      if (refund.status === 'failed' || refund.status === 'canceled') {
        return { id: refund.id, ok: false, message: `Stripe no pudo devolverlo (${refund.failure_reason ?? refund.status}).` };
      }
      return { id: refund.id, ok: true };
    } catch (err) {
      // A request Stripe understood and refused (already refunded, too much…) is final.
      if (
        err instanceof Stripe.errors.StripeInvalidRequestError ||
        err instanceof Stripe.errors.StripeCardError ||
        err instanceof Stripe.errors.StripePermissionError ||
        err instanceof Stripe.errors.StripeAuthenticationError
      ) {
        return { id: '', ok: false, message: `Stripe: ${err.message}` };
      }
      throw new ProviderUnreachable(err instanceof Error ? err.message : 'Stripe no respondió.');
    }
  },

  async paypal(captureId, cents, refundId) {
    const [{ loadPaymentConfig }, { PaypalApiError, refundPaypalCapture }] = await Promise.all([
      import('@/lib/server/payments/config'),
      import('@/lib/server/payments/paypal'),
    ]);
    const { paypal } = await loadPaymentConfig();
    if (!paypal) return { id: '', ok: false, message: 'PayPal no está conectado.' };
    try {
      const refund = await refundPaypalCapture(paypal, captureId, cents, refundId);
      if (refund.status === 'FAILED' || refund.status === 'CANCELLED') {
        return { id: refund.id, ok: false, message: `PayPal no pudo devolverlo (${refund.status}).` };
      }
      return { id: refund.id, ok: true };
    } catch (err) {
      if (err instanceof PaypalApiError && err.status >= 400 && err.status < 500) {
        return { id: '', ok: false, message: `PayPal: ${err.message}` };
      }
      throw new ProviderUnreachable(err instanceof Error ? err.message : 'PayPal no respondió.');
    }
  },
};

// --- Refunds made in the Stripe or PayPal dashboard (webhooks) -----------------

/** A PAYMENT.CAPTURE.REFUNDED resource: which refund, of which capture, how much. */
export function paypalRefundOf(resource: {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string };
  links?: Array<{ rel?: string; href?: string }>;
}): { refundId: string; captureId: string; cents: number } | null {
  if (!resource.id || (resource.status !== 'COMPLETED' && resource.status !== 'PENDING')) return null;
  const up = resource.links?.find((link) => link.rel === 'up')?.href ?? '';
  const captureId = /\/captures\/([^/?#]+)/.exec(up)?.[1];
  const cents = Math.round(Number(resource.amount?.value ?? 0) * 100);
  if (!captureId || !(cents > 0)) return null;
  return { refundId: resource.id, captureId: decodeURIComponent(captureId), cents };
}

/**
 * Record a refund Stripe/PayPal told us about. The database recognises our own
 * (and completes them if they were left pending), takes a refund of everything
 * left as a full refund, and keeps a partial one for Meili to assign.
 */
export async function recordProviderRefund(
  supabase: SupabaseClient,
  provider: 'stripe' | 'paypal',
  paymentRef: string,
  providerRefundId: string,
  cents: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('record_provider_refund', {
    p_provider: provider,
    p_payment_ref: paymentRef,
    p_provider_refund_id: providerRefundId,
    p_amount_cents: cents,
  });
  if (error) throw mapPgError(error);
  const result = String(data);
  if (result === 'completed' || result === 'assigned') {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq(provider === 'paypal' ? 'paypal_capture_id' : 'stripe_payment_intent_id', paymentRef)
      .maybeSingle();
    if (order?.id) {
      const { sendOrderEmails } = await import('./outbox');
      await sendOrderEmails(supabase, String(order.id));
    }
  }
  return result;
}
