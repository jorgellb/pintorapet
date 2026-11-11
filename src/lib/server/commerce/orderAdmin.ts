import type { SupabaseClient } from '@supabase/supabase-js';
import { CommerceError } from './errors';
import { mapPgError } from './pgErrors';

/**
 * Cancelling and deleting orders that were never paid (Admin › Pedidos). The
 * database does the bookkeeping (admin_cancel_order / admin_delete_order, see
 * supabase/migrations/20261111000005_order_admin.sql); this module first closes
 * an open Stripe checkout, so the customer cannot pay an order that is gone.
 * PayPal needs nothing: the site only captures while the attempt is open.
 */

/** Closes a Stripe checkout: 'closed' (or already was), or 'paid' if the customer just paid it. */
export type CheckoutCloser = (sessionId: string) => Promise<'closed' | 'paid'>;

type OrderRow = {
  id: string;
  payment_status: string;
  payment_provider: string | null;
  stripe_session_id: string | null;
};

const CANCELLABLE = ['pending_session', 'checkout_open', 'expired', 'cancelled'];

async function load(client: SupabaseClient, id: string): Promise<OrderRow> {
  const { data, error } = await client
    .from('orders')
    .select('id, payment_status, payment_provider, stripe_session_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgError(error);
  if (!data) throw new CommerceError('UNAVAILABLE', 'Ese pedido ya no existe.', 404);
  return data as OrderRow;
}

function explain(err: { message?: string } | null): CommerceError {
  const message = err?.message ?? '';
  if (message.includes('ORDER_NOT_DELETABLE')) {
    return new CommerceError(
      'VALIDATION',
      'Este pedido no se puede borrar: se llegó a pagar (o movió stock), y sus datos y facturas se guardan. Puedes archivarlo para quitarlo de la lista.',
      409,
    );
  }
  if (message.includes('ORDER_NOT_CANCELLABLE')) {
    return new CommerceError(
      'VALIDATION',
      'Este pedido ya está pagado. Para anularlo, usa «Devolver dinero» o «Cancelar pedido y devolver todo».',
      409,
    );
  }
  return mapPgError(err);
}

export async function cancelOrder(
  client: SupabaseClient,
  id: string,
  closeStripe: CheckoutCloser = closeStripeCheckout,
): Promise<void> {
  const order = await load(client, id);
  if (!CANCELLABLE.includes(order.payment_status)) throw explain({ message: 'ORDER_NOT_CANCELLABLE' });
  if (order.payment_status === 'checkout_open' && order.payment_provider !== 'paypal' && order.stripe_session_id) {
    if ((await closeStripe(order.stripe_session_id)) === 'paid') {
      throw new CommerceError(
        'CONFLICT',
        'La clienta acaba de pagar este pedido en Stripe. Espera unos segundos a que llegue el pago y recarga.',
        409,
      );
    }
  }
  const { error } = await client.rpc('admin_cancel_order', { p_order_id: id });
  if (error) throw explain(error);
}

export async function deleteOrder(
  client: SupabaseClient,
  id: string,
  closeStripe: CheckoutCloser = closeStripeCheckout,
): Promise<void> {
  const order = await load(client, id);
  if (order.payment_status === 'checkout_open' || order.payment_status === 'pending_session') {
    await cancelOrder(client, id, closeStripe);
  }
  const { error } = await client.rpc('admin_delete_order', { p_order_id: id });
  if (error) throw explain(error);
}

/** Every order never paid and abandoned (closed over a day ago, or open over two). */
export async function deleteAbandonedOrders(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('admin_delete_abandoned_orders');
  if (error) throw explain(error);
  return Number(data ?? 0);
}

async function closeStripeCheckout(sessionId: string): Promise<'closed' | 'paid'> {
  const [{ getStripe }, { default: Stripe }] = await Promise.all([import('./stripeClient'), import('stripe')]);
  const stripe = await getStripe();
  if (!stripe) return 'closed';
  const statusOf = async () => (await stripe.checkout.sessions.retrieve(sessionId)).status;
  try {
    const status = await statusOf();
    if (status === 'complete') return 'paid';
    if (status === 'open') {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch (err) {
        // Refused: it may have been paid a moment ago. Look again.
        if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
        if ((await statusOf()) === 'complete') return 'paid';
      }
    }
    return 'closed';
  } catch (err) {
    // A session Stripe does not know cannot be paid.
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') return 'closed';
    throw new CommerceError('UNAVAILABLE', 'Stripe no respondió; inténtalo de nuevo en un momento.', 502);
  }
}
