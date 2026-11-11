import { describe, expect, it, vi } from 'vitest';
import {
  ProviderUnreachable,
  refundRequestSchema,
  retryRefund,
  startRefund,
  type RefundProviders,
} from '../src/lib/server/commerce/refunds';
import { CommerceError } from '../src/lib/server/commerce/errors';

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const REFUND = '33333333-3333-4333-8333-333333333333';

type Rpc = (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };

/** A Supabase client that answers rpc() from a script and one refund row for retries. */
function fakeClient(answer: Rpc, row: Record<string, unknown> | null = null) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const out = answer(name, args);
    return { data: out.data ?? null, error: out.error ?? null };
  });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { client: { rpc, from: () => query } as never, rpc };
}

const begun = (provider: 'stripe' | 'paypal' = 'stripe') => ({
  refund_id: REFUND,
  amount_cents: 999,
  provider,
  payment_ref: provider === 'stripe' ? 'pi_123' : 'CAP123',
  status: 'pending',
});

const input = refundRequestSchema.parse({
  items: [{ orderItemId: ITEM, quantity: 1 }],
  shipping: false,
  restock: true,
  reason: 'No le llegó bien',
});

const providers = (impl: Partial<RefundProviders>): RefundProviders => ({
  stripe: vi.fn(async () => ({ id: 're_1', ok: true })),
  paypal: vi.fn(async () => ({ id: 'PP1', ok: true })),
  ...impl,
});

describe('startRefund', () => {
  it('pays back through Stripe, with the refund as idempotency key, then completes it', async () => {
    const { client, rpc } = fakeClient((name) => (name === 'admin_begin_refund' ? { data: begun() } : {}));
    const p = providers({});
    const out = await startRefund(client, ORDER, input, p);
    expect(p.stripe).toHaveBeenCalledWith('pi_123', 999, REFUND, ORDER);
    expect(rpc).toHaveBeenCalledWith('admin_begin_refund', {
      p_order_id: ORDER,
      p_items: [{ order_item_id: ITEM, quantity: 1 }],
      p_shipping: false,
      p_restock: true,
      p_reason: 'No le llegó bien',
      p_manual: false,
    });
    expect(rpc).toHaveBeenCalledWith('admin_complete_refund', { p_refund_id: REFUND, p_provider_refund_id: 're_1' });
    expect(out).toEqual({ refundId: REFUND, amountCents: 999, status: 'succeeded' });
  });

  it('pays back through PayPal when that is how the order was paid', async () => {
    const { client } = fakeClient((name) => (name === 'admin_begin_refund' ? { data: begun('paypal') } : {}));
    const p = providers({});
    await startRefund(client, ORDER, input, p);
    expect(p.paypal).toHaveBeenCalledWith('CAP123', 999, REFUND, ORDER);
    expect(p.stripe).not.toHaveBeenCalled();
  });

  it('does not call Stripe or PayPal for a refund made there already', async () => {
    const { client } = fakeClient(() => ({ data: { refund_id: REFUND, amount_cents: 999, status: 'succeeded' } }));
    const p = providers({});
    const out = await startRefund(client, ORDER, { ...input, manual: true }, p);
    expect(p.stripe).not.toHaveBeenCalled();
    expect(out.status).toBe('succeeded');
  });

  it('records a refund Stripe refuses as failed, with its reason', async () => {
    const { client, rpc } = fakeClient((name) => (name === 'admin_begin_refund' ? { data: begun() } : {}));
    const p = providers({ stripe: vi.fn(async () => ({ id: '', ok: false, message: 'Charge already refunded' })) });
    const out = await startRefund(client, ORDER, input, p);
    expect(rpc).toHaveBeenCalledWith('admin_fail_refund', { p_refund_id: REFUND, p_error: 'Charge already refunded' });
    expect(out).toMatchObject({ status: 'failed', message: 'Charge already refunded' });
  });

  it('keeps a refund Stripe is still processing pending, with its id, until Stripe confirms it', async () => {
    const { client, rpc } = fakeClient((name) => (name === 'admin_begin_refund' ? { data: begun() } : {}));
    const p = providers({ stripe: vi.fn(async () => ({ id: 're_slow', ok: true, pending: true })) });
    const out = await startRefund(client, ORDER, input, p);
    expect(rpc).toHaveBeenCalledWith('admin_mark_refund_processing', { p_refund_id: REFUND, p_provider_refund_id: 're_slow' });
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain('admin_complete_refund');
    expect(out.status).toBe('pending');
  });

  it('leaves the refund pending when the answer is lost, to retry it safely', async () => {
    const { client, rpc } = fakeClient((name) => (name === 'admin_begin_refund' ? { data: begun() } : {}));
    const p = providers({
      stripe: vi.fn(async () => {
        throw new ProviderUnreachable('timeout');
      }),
    });
    const out = await startRefund(client, ORDER, input, p);
    expect(out.status).toBe('pending');
    const names = rpc.mock.calls.map((call) => call[0]);
    expect(names).not.toContain('admin_complete_refund');
    expect(names).not.toContain('admin_fail_refund');
  });

  it('explains in Spanish why a refund cannot start', async () => {
    const { client } = fakeClient(() => ({ error: { message: 'REFUND_TOO_MUCH' } }));
    const error = await startRefund(client, ORDER, input, providers({})).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CommerceError);
    expect((error as CommerceError).message).toMatch(/No queda tanto por devolver/);
  });

  it('says how much Stripe already gave back when the pieces do not match it', async () => {
    const { client } = fakeClient(() => ({ error: { message: 'REFUND_AMOUNT_MISMATCH: 1299' } }));
    const error = (await startRefund(client, ORDER, { ...input, manual: true }, providers({})).catch((err: unknown) => err)) as CommerceError;
    expect(error.message).toContain('12,99');
  });
});

describe('retryRefund', () => {
  it('asks again with the same key, and completes it', async () => {
    const row = {
      id: REFUND,
      order_id: ORDER,
      status: 'pending',
      channel: 'api',
      provider: 'stripe',
      amount_cents: 999,
      orders: { stripe_payment_intent_id: 'pi_123', paypal_capture_id: null },
    };
    const { client, rpc } = fakeClient(() => ({}), row);
    const p = providers({});
    const out = await retryRefund(client, REFUND, p);
    expect(p.stripe).toHaveBeenCalledWith('pi_123', 999, REFUND, ORDER);
    expect(rpc).toHaveBeenCalledWith('admin_complete_refund', { p_refund_id: REFUND, p_provider_refund_id: 're_1' });
    expect(out.status).toBe('succeeded');
  });

  it('only retries a refund still on its way', async () => {
    const { client } = fakeClient(() => ({}), { id: REFUND, status: 'succeeded', channel: 'api', orders: {} });
    await expect(retryRefund(client, REFUND, providers({}))).rejects.toBeInstanceOf(CommerceError);
  });
});
