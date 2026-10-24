import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Just enough of the Supabase client: one rpc and update().eq().eq(). */
function fakeSupabase(rows: unknown[], rpcError: unknown = null) {
  const updates: Array<{ values: Record<string, unknown>; id: unknown }> = [];
  const client = {
    rpc: vi.fn(async () => ({ data: rows, error: rpcError })),
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, id: unknown) => ({
          eq: async () => {
            updates.push({ values, id });
            return { error: null };
          },
        }),
      }),
    }),
  };
  return { client: client as never, updates, rpc: client.rpc };
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
    const { client, updates, rpc } = fakeSupabase([
      paid('r1', 'order_paid_customer', 'ana@example.com'),
      paid('r2', 'order_paid_admin', 'admin'),
    ]);
    await sendOrderEmails(client, 'order-1');

    expect(rpc).toHaveBeenCalledWith('claim_outbox_for_order', expect.objectContaining({ p_order_id: 'order-1' }));
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

  it('does not break the payment when the database is unreachable', async () => {
    const { client } = fakeSupabase([], { message: 'timeout' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendOrderEmails(client, 'order-1')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
