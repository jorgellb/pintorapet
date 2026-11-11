import { describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const create = vi.fn();
vi.mock('../src/lib/server/commerce/stripeClient', () => ({
  getStripe: async () => ({ refunds: { list, create } }),
}));

const { defaultProviders } = await import('../src/lib/server/commerce/refunds');

describe('Stripe refunds', () => {
  it('never pays back twice: a late retry finds the refund already made', async () => {
    list.mockResolvedValue({ data: [{ id: 're_old', status: 'succeeded', metadata: { refund_id: 'ref-1' } }] });
    const out = await defaultProviders.stripe('pi_1', 999, 'ref-1', 'order-1');
    expect(out).toEqual({ id: 're_old', ok: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates it, with the refund as idempotency key, when there is none', async () => {
    list.mockResolvedValue({ data: [{ id: 're_other', status: 'succeeded', metadata: { refund_id: 'ref-0' } }] });
    create.mockResolvedValue({ id: 're_new', status: 'succeeded' });
    const out = await defaultProviders.stripe('pi_1', 999, 'ref-2', 'order-1');
    expect(out).toEqual({ id: 're_new', ok: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 999, metadata: { refund_id: 'ref-2', order_id: 'order-1' } }),
      { idempotencyKey: 'pd-refund-ref-2' },
    );
  });
});
