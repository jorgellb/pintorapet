import { describe, expect, it, vi } from 'vitest';
import { cancelOrder, deleteOrder, type CheckoutCloser } from '../src/lib/server/commerce/orderAdmin';
import { CommerceError } from '../src/lib/server/commerce/errors';

const ORDER = '11111111-1111-4111-8111-111111111111';

function fakeClient(order: Record<string, unknown> | null, rpcError: string | null = null) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => ({ data: 'cancelled', error: rpcError ? { message: rpcError } : null }));
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: order, error: null }) };
  return { client: { rpc, from: () => query } as never, rpc };
}

const open = { id: ORDER, payment_status: 'checkout_open', payment_provider: 'stripe', stripe_session_id: 'cs_1' };

describe('cancelOrder', () => {
  it('closes the Stripe checkout first, so the customer cannot pay a cancelled order', async () => {
    const { client, rpc } = fakeClient(open);
    const close: CheckoutCloser = vi.fn(async () => 'closed' as const);
    await cancelOrder(client, ORDER, close);
    expect(close).toHaveBeenCalledWith('cs_1');
    expect(rpc).toHaveBeenCalledWith('admin_cancel_order', { p_order_id: ORDER });
  });

  it('does not cancel an order whose Stripe checkout was just paid', async () => {
    const { client, rpc } = fakeClient(open);
    const close: CheckoutCloser = vi.fn(async () => 'paid' as const);
    const error = await cancelOrder(client, ORDER, close).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CommerceError);
    expect((error as CommerceError).message).toMatch(/acaba de pagar/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('needs no Stripe call for PayPal or for an expired order', async () => {
    const close: CheckoutCloser = vi.fn(async () => 'closed' as const);
    await cancelOrder(fakeClient({ ...open, payment_provider: 'paypal' }).client, ORDER, close);
    await cancelOrder(fakeClient({ ...open, payment_status: 'expired' }).client, ORDER, close);
    expect(close).not.toHaveBeenCalled();
  });

  it('explains why a paid order cannot be cancelled here', async () => {
    const { client } = fakeClient({ ...open, payment_status: 'paid' });
    const error = (await cancelOrder(client, ORDER, vi.fn()).catch((err: unknown) => err)) as CommerceError;
    expect(error.message).toMatch(/Devolver dinero/);
  });
});

describe('deleteOrder', () => {
  it('cancels an open order before deleting it', async () => {
    const { client, rpc } = fakeClient(open);
    await deleteOrder(client, ORDER, vi.fn(async () => 'closed' as const));
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(['admin_cancel_order', 'admin_delete_order']);
  });

  it('explains why a paid order is kept', async () => {
    const { client } = fakeClient({ ...open, payment_status: 'expired' }, 'ORDER_NOT_DELETABLE');
    const error = (await deleteOrder(client, ORDER, vi.fn()).catch((err: unknown) => err)) as CommerceError;
    expect(error.message).toMatch(/no se puede borrar/);
  });
});
