import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/commerce/outbox', () => ({ sendOrderEmails: vi.fn() }));
vi.mock('@/lib/server/shipping/correos', async (original) => ({
  ...(await original<typeof import('../src/lib/server/shipping/correos')>()),
  loadCorreosConfig: async () => ({ mode: 'live' }),
  cancelShipment: vi.fn(),
}));
vi.mock('@/lib/server/db', () => ({
  db: () => ({ run: vi.fn() }),
  insertValues: () => '',
  json: (v: unknown) => v,
  sql: () => '',
  serviceDb: () => null,
}));

const { cancelCorreosShipment, markShipped } = await import('../src/lib/server/shipping/admin');

/** An order in a given shipping state, and the SQL the code runs. */
function client(fulfillment: string) {
  const runs: string[] = [];
  const order = {
    id: 'o1',
    reference: 'PD-1',
    locale: 'es',
    payment_status: 'paid',
    fulfillment_status: fulfillment,
    customer_email: null,
    carrier: 'correos',
    carrier_shipment_code: 'PK1',
    tracking_code: 'PK1234',
  };
  return {
    runs,
    db: {
      one: async () => order,
      run: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        runs.push(strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i]) : ''), ''));
      },
    } as never,
  };
}

describe('a parcel Correos is already carrying', () => {
  for (const state of ['in_transit', 'out_for_delivery', 'incident', 'returned']) {
    it(`cannot be annulled once ${state}`, async () => {
      await expect(cancelCorreosShipment(client(state).db, 'o1')).rejects.toThrow(/ya salió/);
    });
  }

  it('keeps its state when marked as sent again', async () => {
    const c = client('in_transit');
    await markShipped(c.db, 'o1', { carrier: 'correos', trackingCode: 'PK1234', notify: false });
    expect(c.runs.join(' ')).not.toMatch(/fulfillment_status = 'shipped'/);
  });

  it('a parcel still being prepared becomes sent', async () => {
    const c = client('preparing');
    await markShipped(c.db, 'o1', { carrier: 'correos', trackingCode: 'PK1234', notify: false });
    expect(c.runs.join(' ')).toMatch(/shipped/);
  });
});
