import { json, type Db } from '@/lib/server/db';
import type { PaypalConfig } from '@/lib/server/payments/config';
import {
  capturePaypalOrder,
  centsOf,
  firstCapture,
  getPaypalOrder,
  payerNameOf,
  shippingOf,
  type PaypalOrder,
} from '@/lib/server/payments/paypal';
import { dbCall } from './pgErrors';
import { sendOrderEmails } from './outbox';

export type PaypalOutcome = {
  status: 'paid' | 'review' | 'pending' | 'expired' | 'not_found';
  reference?: string;
  locale?: 'en' | 'es';
};

type AttemptRow = {
  id: string;
  status: string;
  order_id: string;
  orders: { reference: string; locale: 'en' | 'es'; payment_status: string } | null;
};

/**
 * Captures an approved PayPal order and records the payment. Safe to call more
 * than once (return page, webhook): captures and payments are idempotent.
 * An attempt whose reservation already lapsed is never captured.
 */
export async function finalizePaypalOrder(
  supabase: Db,
  creds: PaypalConfig,
  paypalOrderId: string,
): Promise<PaypalOutcome> {
  const attempt = await dbCall(() => supabase.one<AttemptRow>`
    select a.id, a.status, a.order_id,
           (select json_build_object('reference', o.reference, 'locale', o.locale, 'payment_status', o.payment_status)
            from public.orders o where o.id = a.order_id) as orders
    from public.checkout_attempts a where a.paypal_order_id = ${paypalOrderId}`);
  if (!attempt?.orders) return { status: 'not_found' };

  const base = { reference: attempt.orders.reference, locale: attempt.orders.locale };
  if (attempt.orders.payment_status === 'paid') return { status: 'paid', ...base };

  let order: PaypalOrder = await getPaypalOrder(creds, paypalOrderId);
  const open = attempt.status === 'session_open' || attempt.status === 'creating_session';

  if (order.status === 'APPROVED' && open) {
    order = await capturePaypalOrder(creds, paypalOrderId, `capture:${attempt.id}`);
  }

  const capture = firstCapture(order);
  if (order.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
    return { status: open ? 'pending' : 'expired', ...base };
  }

  // Details typed on our checkout form (with phone and note) win over PayPal's copy.
  const saved = await supabase.one<{ shipping_address: unknown }>`
    select shipping_address from public.orders where id = ${attempt.order_id}`;
  const fromForm = Boolean(saved?.shipping_address);

  const shipping = fromForm ? null : shippingOf(order);
  const applied = await dbCall(() =>
    supabase.call('apply_paypal_payment', {
      p_order_id: attempt.order_id,
      p_paypal_order_id: paypalOrderId,
      p_capture_id: capture.id,
      p_amount_total_cents: centsOf(capture.amount?.value),
      p_currency: (capture.amount?.currency_code ?? 'EUR').toUpperCase(),
      p_customer_email: fromForm ? null : (order.payer?.email_address ?? null),
      p_customer_name: fromForm ? null : payerNameOf(order),
      p_shipping_address: shipping === null ? null : json(shipping),
    }),
  );
  await sendOrderEmails(supabase, attempt.order_id);

  const status = (applied as { status?: string } | null)?.status === 'review' ? 'review' : 'paid';
  return { status, ...base };
}

/** Frees the stock of an attempt the buyer cancelled on PayPal. */
export async function cancelPaypalOrder(
  supabase: Db,
  paypalOrderId: string,
): Promise<{ locale?: 'en' | 'es' }> {
  const attempt = await supabase.one<{ id: string; status: string; orders: { locale: 'en' | 'es' } | null }>`
    select a.id, a.status, (select json_build_object('locale', o.locale) from public.orders o where o.id = a.order_id) as orders
    from public.checkout_attempts a where a.paypal_order_id = ${paypalOrderId}`;
  if (!attempt) return {};
  if (attempt.status === 'session_open' || attempt.status === 'creating_session') {
    await dbCall(() => supabase.call('release_reservations', { p_attempt_id: attempt.id, p_reason: 'cancelled' }));
  }
  return { locale: attempt.orders?.locale };
}
