import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';
import { reviewInputSchema } from '../src/lib/domain/reviews';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';

/** What happened, in order: the transaction's edges and the statements run inside it. */
const events: string[] = [];
let breakNotice = false;

const stand = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/server/commerce/outbox', () => ({ sendOutboxNow: vi.fn(async () => true) }));
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('../src/lib/server/db')>()),
  serviceDb: () => stand.db,
  // The real transaction() needs a pool; this one keeps its contract: begin, the work, commit or rollback.
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    events.push('begin');
    try {
      const out = await fn(stand.db);
      events.push('commit');
      return out;
    } catch (err) {
      events.push('rollback');
      throw err;
    }
  },
}));

const { submitCustomerReview } = await import('../src/lib/server/reviews/store');
const { reviewKey } = await import('../src/lib/server/reviews/link');

beforeEach(() => {
  vi.stubEnv('REVIEW_LINK_SECRET', 'secret');
  vi.stubEnv('RESEND_API_KEY', '');
  events.length = 0;
  breakNotice = false;
  stand.db = fakeDb({
    query: (q) => {
      if (/^\s*insert into public.notification_outbox/i.test(q.text)) {
        events.push('notice');
        if (breakNotice) throw new Error('outbox down');
        return 1;
      }
      if (/^\s*insert into public.reviews/i.test(q.text)) {
        events.push('review');
        return { id: REVIEW_ID };
      }
      if (q.text.includes('from public.orders')) {
        return { id: ORDER_ID, reference: 'PD-1', locale: 'es', payment_status: 'paid', paid_at: new Date().toISOString(), commission_request_id: null };
      }
      return undefined;
    },
  }).db;
});

const input = () =>
  reviewInputSchema.parse({ reference: 'PD-1', key: reviewKey(ORDER_ID), body: 'Preciosa', authorName: 'Ana G.', locale: 'es', consent: true });

describe('the review and its notice to Meili', () => {
  it('are saved inside one transaction', async () => {
    await submitCustomerReview(input(), { ip: 'x' });
    expect(events).toEqual(['begin', 'review', 'notice', 'commit']);
  });

  it('a failing notice rolls the whole transaction back, so no review is left that Meili never hears about', async () => {
    breakNotice = true;
    await expect(submitCustomerReview(input(), { ip: 'x' })).rejects.toBeTruthy();
    expect(events).toEqual(['begin', 'review', 'notice', 'rollback']);
  });
});
