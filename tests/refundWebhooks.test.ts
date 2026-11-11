import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { paypalRefundOf } from '../src/lib/server/commerce/refunds';
import { handleStripeEvent } from '../src/lib/server/commerce/webhook';

describe('paypalRefundOf', () => {
  it('reads the refund, its capture and the amount from a PAYMENT.CAPTURE.REFUNDED resource', () => {
    expect(
      paypalRefundOf({
        id: '1JU08902781691411',
        status: 'COMPLETED',
        amount: { value: '13.48', currency_code: 'EUR' },
        links: [
          { rel: 'self', href: 'https://api.paypal.com/v2/payments/refunds/1JU08902781691411' },
          { rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/2GG279541U471931P' },
        ],
      }),
    ).toEqual({ refundId: '1JU08902781691411', captureId: '2GG279541U471931P', cents: 1348 });
  });

  it('only takes a refund PayPal completed', () => {
    const links = [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP1' }];
    expect(paypalRefundOf({ id: 'X', status: 'FAILED', amount: { value: '1.00' }, links })).toBeNull();
    expect(paypalRefundOf({ id: 'X', status: 'PENDING', amount: { value: '1.00' }, links })).toBeNull();
  });
});

/** rpc() for record_provider_refund, upsert() for stripe_events, select() to find the order. */
function fakeSupabase(result: string) {
  const rpc = vi.fn(async () => ({ data: result, error: null }));
  const upsert = vi.fn(async () => ({ error: null }));
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'order-1' }, error: null }) };
  return { client: { rpc, from: () => ({ upsert, ...query }) } as never, rpc, upsert };
}

const refundEvent = (status: string): Stripe.Event =>
  ({
    id: 'evt_1',
    type: 'refund.created',
    data: { object: { id: 're_1', object: 'refund', amount: 999, payment_intent: 'pi_1', status } },
  }) as unknown as Stripe.Event;

describe('Stripe refund events', () => {
  it('records a refund made in the Stripe dashboard', async () => {
    const { client, rpc } = fakeSupabase('unassigned');
    await handleStripeEvent(client, refundEvent('succeeded'));
    expect(rpc).toHaveBeenCalledWith('record_provider_refund', {
      p_provider: 'stripe',
      p_payment_ref: 'pi_1',
      p_provider_refund_id: 're_1',
      p_amount_cents: 999,
    });
  });

  it('waits while Stripe is still processing a refund', async () => {
    const { client, rpc } = fakeSupabase('unassigned');
    await handleStripeEvent(client, refundEvent('pending'));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('marks a refund Stripe could not make as failed (or for review if it was done)', async () => {
    const { client, rpc } = fakeSupabase('failed');
    const event = refundEvent('failed');
    (event.data.object as unknown as { failure_reason: string }).failure_reason = 'expired_or_canceled_card';
    await handleStripeEvent(client, event);
    expect(rpc).toHaveBeenCalledWith('provider_refund_failed', {
      p_provider_refund_id: 're_1',
      p_reason: 'expired_or_canceled_card',
    });
  });
});
