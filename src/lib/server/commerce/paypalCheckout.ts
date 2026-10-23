import type { SupabaseClient } from '@supabase/supabase-js';
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
import { mapPgError } from './pgErrors';

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
  supabase: SupabaseClient,
  creds: PaypalConfig,
  paypalOrderId: string,
): Promise<PaypalOutcome> {
  const { data, error } = await supabase
    .from('checkout_attempts')
    .select('id, status, order_id, orders(reference, locale, payment_status)')
    .eq('paypal_order_id', paypalOrderId)
    .maybeSingle();
  if (error) throw mapPgError(error);
  const attempt = data as unknown as AttemptRow | null;
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

  const { data: applied, error: applyErr } = await supabase.rpc('apply_paypal_payment', {
    p_order_id: attempt.order_id,
    p_paypal_order_id: paypalOrderId,
    p_capture_id: capture.id,
    p_amount_total_cents: centsOf(capture.amount?.value),
    p_currency: (capture.amount?.currency_code ?? 'EUR').toUpperCase(),
    p_customer_email: order.payer?.email_address ?? null,
    p_customer_name: payerNameOf(order),
    p_shipping_address: shippingOf(order),
  });
  if (applyErr) throw mapPgError(applyErr);

  const status = (applied as { status?: string } | null)?.status === 'review' ? 'review' : 'paid';
  return { status, ...base };
}

/** Frees the stock of an attempt the buyer cancelled on PayPal. */
export async function cancelPaypalOrder(
  supabase: SupabaseClient,
  paypalOrderId: string,
): Promise<{ locale?: 'en' | 'es' }> {
  const { data } = await supabase
    .from('checkout_attempts')
    .select('id, status, orders(locale)')
    .eq('paypal_order_id', paypalOrderId)
    .maybeSingle();
  const attempt = data as unknown as { id: string; status: string; orders: { locale: 'en' | 'es' } | null } | null;
  if (!attempt) return {};
  if (attempt.status === 'session_open' || attempt.status === 'creating_session') {
    const { error } = await supabase.rpc('release_reservations', {
      p_attempt_id: attempt.id,
      p_reason: 'cancelled',
    });
    if (error) throw mapPgError(error);
  }
  return { locale: attempt.orders?.locale };
}
