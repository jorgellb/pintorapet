import { afterEach, describe, expect, it, vi } from 'vitest';

const inserted: Array<Record<string, unknown>> = [];
vi.mock('@/lib/server/commerce/outbox', () => ({ sendOrderEmails: vi.fn() }));
vi.mock('@/lib/server/shipping/correos', async (original) => ({
  ...(await original<typeof import('../src/lib/server/shipping/correos')>()),
  loadCorreosConfig: async () => ({ mode: 'live' }),
}));
vi.mock('@/lib/server/db', () => ({
  db: () => ({ run: vi.fn() }),
  insertValues: (row: Record<string, unknown>) => {
    inserted.push(row);
    return '';
  },
  json: (v: unknown) => v,
  sql: () => '',
  serviceDb: () => null,
}));

const { markShipped } = await import('../src/lib/server/shipping/admin');

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'PD-1',
  locale: 'es',
  payment_status: 'paid',
  paid_at: new Date().toISOString(),
  fulfillment_status: 'unfulfilled',
  customer_email: 'ana@example.com',
};
const client = { one: async () => order, run: async () => 1 } as never;

afterEach(() => {
  vi.unstubAllEnvs();
  inserted.length = 0;
});

describe('the shipped email and the review link', () => {
  it('carries the review link while the order can be reviewed', async () => {
    vi.stubEnv('REVIEW_LINK_SECRET', 'secret');
    await markShipped(client, order.id, { carrier: 'other', trackingCode: 'T1', notify: true });
    const payload = JSON.parse(String(inserted[0]!.payload)) as { review_url: string | null };
    expect(payload.review_url).toContain('/es/opinion/?r=PD-1&k=');
  });

  it('is still sent, without the link, when the link cannot be made', async () => {
    vi.stubEnv('REVIEW_LINK_SECRET', '');
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await markShipped(client, order.id, { carrier: 'other', trackingCode: 'T1', notify: true });
    expect(inserted).toHaveLength(1);
    expect(JSON.parse(String(inserted[0]!.payload))).toMatchObject({ reference: 'PD-1', tracking_code: 'T1', review_url: null });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
