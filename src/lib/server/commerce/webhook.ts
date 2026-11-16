import { json, upsert, type Db } from '@/lib/server/db';
import type Stripe from 'stripe';
import { CommerceError } from './errors';
import { dbCall } from './pgErrors';
import { sendOrderEmails } from './outbox';
import { loadPaymentConfig } from '@/lib/server/payments/config';
import { stripeFor } from './stripeClient';
import { recordProviderRefund, recordProviderRefundFailed } from './refunds';

export async function constructStripeEvent(
  rawBody: string,
  signature: string,
): Promise<Stripe.Event> {
  const { stripe: config } = await loadPaymentConfig();
  const secret = config?.webhookSecret;
  const stripe = config ? stripeFor(config.secretKey) : null;
  if (!stripe || !secret) {
    throw new CommerceError(
      'NOT_CONFIGURED',
      'Stripe webhook not configured',
      503,
    );
  }
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new CommerceError(
      'VALIDATION',
      'Invalid Stripe signature',
      400,
      err,
    );
  }
}

export async function handleStripeEvent(
  supabase: Db,
  event: Stripe.Event,
): Promise<{ handled: boolean; detail?: unknown }> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        // Record and wait for a later paid event
        await recordEvent(supabase, {
            event_id: event.id,
            event_type: event.type,
            related_object_id: session.id,
            status: 'ignored',
            payload_summary: {
              payment_status: session.payment_status,
            },
          });
        return { handled: true, detail: { ignored: 'not_paid' } };
      }

      const orderId =
        session.metadata?.order_id || session.client_reference_id;
      if (!orderId) {
        throw new CommerceError(
          'VALIDATION',
          'Stripe session missing order reference',
          400,
        );
      }

      const paymentIntent =
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
      const shipping = stripeShippingAddress(session);
      const data = (
        await dbCall(() => supabase.one<{ result: unknown }>`
          select public.apply_payment(
            p_order_id => ${orderId}, p_stripe_event_id => ${event.id}, p_stripe_session_id => ${session.id},
            p_stripe_payment_intent_id => ${paymentIntent}, p_amount_total_cents => ${session.amount_total ?? 0},
            p_currency => ${(session.currency ?? 'eur').toUpperCase()},
            p_customer_email => ${session.customer_details?.email ?? null},
            p_customer_name => ${session.customer_details?.name ?? null},
            p_shipping_address => ${shipping === null ? null : json(shipping)}) as result`)
      )?.result;
      await sendOrderEmails(supabase, orderId);
      return { handled: true, detail: data };
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const attemptId = session.metadata?.attempt_id;
      if (!attemptId) {
        await recordEvent(supabase, {
            event_id: event.id,
            event_type: event.type,
            related_object_id: session.id,
            status: 'ignored',
            payload_summary: { reason: 'no_attempt_id' },
          });
        return { handled: true, detail: { ignored: true } };
      }

      const data = (
        await dbCall(() => supabase.one<{ result: unknown }>`
          select public.release_reservations(p_attempt_id => ${attemptId}, p_reason => 'stripe_session_expired') as result`)
      )?.result;

      await recordEvent(supabase, {
          event_id: event.id,
          event_type: event.type,
          related_object_id: session.id,
          status: 'processed',
          processed_at: new Date().toISOString(),
          payload_summary: { attempt_id: attemptId, result: data },
        });

      return { handled: true, detail: data };
    }

    // A refund: ours (confirmed), or made in the Stripe dashboard.
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const refund = event.data.object as Stripe.Refund;
      const paymentIntent =
        typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null;
      // Only a refund Stripe completed is booked; a pending one comes again when it settles.
      const result =
        refund.status === 'succeeded' && paymentIntent
          ? await recordProviderRefund(supabase, 'stripe', paymentIntent, refund.id, refund.amount)
          : refund.status === 'failed' || refund.status === 'canceled'
            ? await recordProviderRefundFailed(supabase, refund.id, refund.failure_reason ?? refund.status)
            : 'ignored';
      await recordEvent(supabase, {
          event_id: event.id,
          event_type: event.type,
          related_object_id: refund.id,
          status: result === 'ignored' ? 'ignored' : 'processed',
          processed_at: new Date().toISOString(),
          payload_summary: { refund_status: refund.status, result },
        });
      return { handled: true, detail: result };
    }

    default: {
      await recordEvent(supabase, {
          event_id: event.id,
          event_type: event.type,
          related_object_id: null,
          status: 'ignored',
          payload_summary: { type: event.type },
        });
      return { handled: true, detail: { ignored: event.type } };
    }
  }
}

/** Logs a Stripe event once (event_id); a later event with the same id updates what it brings. */
async function recordEvent(
  db: Db,
  row: {
    event_id: string;
    event_type: string;
    related_object_id: string | null;
    status: string;
    processed_at?: string;
    payload_summary: Record<string, unknown>;
  },
): Promise<void> {
  // Like the Supabase upsert it replaces, a failure to log never stops the webhook.
  await db.run(upsert('stripe_events', { ...row, payload_summary: JSON.stringify(row.payload_summary) }, ['event_id'])).catch(() => 0);
}

type StripeShipping = { name?: string | null; address?: Record<string, unknown> | null };

/** Newer API versions move shipping under collected_information. */
function stripeShippingAddress(session: Stripe.Checkout.Session): Record<string, unknown> | null {
  const loose = session as unknown as {
    collected_information?: { shipping_details?: StripeShipping | null } | null;
    shipping_details?: StripeShipping | null;
  };
  const shipping = loose.collected_information?.shipping_details ?? loose.shipping_details ?? null;
  if (!shipping?.address) return null;
  return {
    ...shipping.address,
    name: shipping.name ?? session.customer_details?.name ?? '',
    phone: session.customer_details?.phone ?? '',
  };
}
