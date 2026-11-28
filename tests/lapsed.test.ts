import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';

const stripe = vi.hoisted(() => ({ status: 'expired' as string | Error }));

vi.mock('@/lib/server/payments/config', () => ({
  loadPaymentConfig: async () => ({ stripe: { secretKey: 'sk_test', enabled: true }, paypal: null }),
}));
vi.mock('@/lib/server/commerce/stripeClient', () => ({
  stripeFor: () => ({
    checkout: {
      sessions: {
        retrieve: async () => {
          if (stripe.status instanceof Error) throw stripe.status;
          return { status: stripe.status };
        },
      },
    },
  }),
}));

const { releaseLapsedCheckouts } = await import('../src/lib/server/commerce/lapsed');

const lapsed = [
  { attempt_id: 'paypal-1', provider: 'paypal', stripe_session_id: null, ask_stripe: false },
  { attempt_id: 'never-opened', provider: 'stripe', stripe_session_id: null, ask_stripe: false },
  { attempt_id: 'ended', provider: 'stripe', stripe_session_id: 'cs_1', ask_stripe: true },
];

function db() {
  return fakeDb({ query: ({ text }) => (text.includes('lapsed_attempts') ? lapsed : undefined) });
}
const released = (queries: { text: string; values: unknown[] }[]) =>
  queries.filter((q) => q.text.includes('release_reservations')).map((q) => q.values);

beforeEach(() => {
  stripe.status = 'expired';
});

describe('lapsed checkouts', () => {
  it('frees each one in its own statement, a Stripe session only once Stripe says it expired', async () => {
    const { db: client, queries } = db();
    expect(await releaseLapsedCheckouts(client, { askStripe: true })).toBe(3);
    expect(released(queries)).toEqual([
      ['paypal-1', 'paypal_expired'],
      ['never-opened', 'lapsed'],
      ['ended', 'stripe_session_expired'],
    ]);
  });

  it('keeps the pieces of a session Stripe has as complete (paid, or a slow payment on its way), and notes it asked', async () => {
    stripe.status = 'complete';
    const { db: client, queries } = db();
    await releaseLapsedCheckouts(client, { askStripe: true });
    expect(released(queries).map(([id]) => id)).toEqual(['paypal-1', 'never-opened']);
    const noted = queries.filter((q) => q.text.includes('stripe_checked_at = now()')).map((q) => q.values);
    expect(noted).toEqual([['ended']]);
  });

  it('asks the database for no Stripe sessions when the caller will not ask Stripe', async () => {
    const { db: client, queries } = db();
    await releaseLapsedCheckouts(client, { askStripe: false });
    expect(queries[0].values).toEqual([0]);
    const asking = db();
    await releaseLapsedCheckouts(asking.db, { askStripe: true });
    expect(asking.queries[0].values).toEqual([10]);
  });

  it('keeps them too when Stripe cannot be asked, or the caller cannot wait', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    stripe.status = new Error('Stripe down');
    const first = db();
    await releaseLapsedCheckouts(first.db, { askStripe: true });
    expect(released(first.queries).map(([id]) => id)).toEqual(['paypal-1', 'never-opened']);
    const second = db();
    await releaseLapsedCheckouts(second.db, { askStripe: false });
    expect(released(second.queries).map(([id]) => id)).toEqual(['paypal-1', 'never-opened']);
    log.mockRestore();
  });
});
