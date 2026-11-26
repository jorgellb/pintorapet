import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';

const send = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock('@/lib/server/env', () => ({
  hasResend: () => true,
  emailAdmin: () => 'info@petsdrawings.com',
  emailFrom: () => 'Pets Drawings <orders@petsdrawings.com>',
  siteUrl: () => 'https://petsdrawings.com',
}));

const { sendOrderEmails } = await import('../src/lib/server/commerce/outbox');

/** The claim returns `rows`; each outbox update is recorded as { status, last_error, id }. */
function fakeSupabase(rows: unknown[], claimError: unknown = null) {
  const updates: Array<{ values: Record<string, unknown>; id: unknown }> = [];
  const { db, queries } = fakeDb({
    query: (q) => {
      if (q.text.includes('claim_outbox_for_order')) {
        if (claimError) throw claimError;
        return rows;
      }
      if (q.text.includes('update public.notification_outbox')) {
        const [owner, id, lastError] = [q.values.at(-1), q.values.at(-2), q.values.at(-3)];
        const sent = q.text.includes("status = 'sent'");
        updates.push({ values: sent ? { status: 'sent' } : { status: 'failed', last_error: lastError }, id });
        return owner ? 1 : 0;
      }
      return undefined;
    },
  });
  return { client: db, updates, queries };
}

const paid = (id: string, template: string, recipient: string) => ({
  id,
  recipient,
  locale: 'es',
  template_key: template,
  payload: { order_id: 'order-1', reference: 'PD-ABC123' },
  attempt_count: 1,
});

describe('sendOrderEmails', () => {
  beforeEach(() => send.mockReset());

  it("claims only that order's emails and sends them now", async () => {
    send.mockResolvedValue({ error: null });
    const { client, updates, queries } = fakeSupabase([
      paid('r1', 'order_paid_customer', 'ana@example.com'),
      paid('r2', 'order_paid_admin', 'admin'),
    ]);
    await sendOrderEmails(client, 'order-1');

    expect(queries[0]?.text).toContain('claim_outbox_for_order(p_order_id => $1');
    expect(queries[0]?.values[0]).toBe('order-1');
    expect(send.mock.calls.map(([mail]) => mail.to)).toEqual(['ana@example.com', 'info@petsdrawings.com']);
    const studio = send.mock.calls[1][0];
    expect(studio.subject).toBe('Pedido nuevo PD-ABC123');
    expect(studio.text).toContain('https://petsdrawings.com/admin/orders/order-1/');
    expect(updates.map((u) => [u.id, u.values.status])).toEqual([
      ['r1', 'sent'],
      ['r2', 'sent'],
    ]);
  });

  it('leaves a failed email queued for the cron and never throws', async () => {
    send.mockResolvedValue({ error: { message: 'domain not verified' } });
    const { client, updates } = fakeSupabase([paid('r1', 'order_paid_customer', 'ana@example.com')]);
    await expect(sendOrderEmails(client, 'order-1')).resolves.toBeUndefined();
    expect(updates[0].values).toMatchObject({ status: 'failed', last_error: 'domain not verified' });
  });

  it('tells the customer how much comes back, and where', async () => {
    send.mockResolvedValue({ error: null });
    const row = {
      ...paid('r1', 'order_refunded_customer', 'ana@example.com'),
      payload: { order_id: 'order-1', reference: 'PD-ABC123', amount_cents: 1348, provider: 'paypal', full: false },
    };
    const { client } = fakeSupabase([row]);
    await sendOrderEmails(client, 'order-1');
    const mail = send.mock.calls[0][0];
    expect(mail.subject).toBe('Devolución de tu pedido PD-ABC123');
    expect(mail.text).toContain('13,48');
    expect(mail.text).toContain('PayPal');
  });

  it('tells a customer who paid by Bizum that the money goes back by Bizum', async () => {
    send.mockResolvedValue({ error: null });
    const row = {
      ...paid('r2', 'order_refunded_customer', 'ana@example.com'),
      payload: { order_id: 'order-1', reference: 'PD-ABC123', amount_cents: 999, provider: 'bizum', full: true },
    };
    const { client } = fakeSupabase([row]);
    await sendOrderEmails(client, 'order-1');
    expect(send.mock.calls[0][0].text).toContain('Bizum');
  });

  it('tells a customer who paid by transfer that the money goes back to the bank', async () => {
    send.mockResolvedValue({ error: null });
    const row = {
      ...paid('r1', 'order_refunded_customer', 'ana@example.com'),
      payload: { order_id: 'order-1', reference: 'PD-ABC123', amount_cents: 999, provider: 'transfer', full: true },
    };
    const { client } = fakeSupabase([row]);
    await sendOrderEmails(client, 'order-1');
    expect(send.mock.calls[0][0].text).toContain('transferencia');
  });

  it('does not break the payment when the database is unreachable', async () => {
    const { client } = fakeSupabase([], { message: 'timeout' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendOrderEmails(client, 'order-1')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
