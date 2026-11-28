/**
 * Rows for integration tests against a real PostgreSQL (TEST_DATABASE_URL):
 * a 15 € order for one tracked piece with its checkout open on Stripe. Each
 * call makes its own product, quote, order and checkout.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/lib/server/db';

export type OpenOrder = { orderId: string; attemptId: string; productId: string; sessionId: string; quoteId: string };

export async function openOrder(
  db: Db,
  opts: {
    stock?: number;
    reserve?: boolean;
    /** stock_reserved on the inventory row (by default, the reservation's 1). */
    held?: number;
    postal?: string;
    total?: number;
    owner?: string;
    attemptStatus?: 'creating_session' | 'session_open';
    attemptAgo?: string;
    sessionExpiresAgo?: string;
  } = {},
): Promise<OpenOrder> {
  const { stock = 1, reserve = true, postal = '28001', total = 1500, owner = 'owner' } = opts;
  const held = opts.held ?? (reserve ? 1 : 0);
  const productId = randomUUID();
  const orderId = randomUUID();
  const attemptId = randomUUID();
  const quoteId = randomUUID();
  const sessionId = `cs_test_${randomUUID()}`;
  const sku = `TEST-${productId.slice(0, 8)}`;
  const category = await db.one<{ id: string }>`select id from public.categories order by code limit 1`;
  await db.run`
    insert into public.products (id, sku, category_id, motif, price_cents, status, sale_enabled)
    values (${productId}, ${sku}, ${category!.id}, 'dog', ${total}, 'published', true)`;
  await db.run`
    insert into public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
    values (${productId}, ${stock}, ${held}, 'tracked')`;
  await db.run`
    insert into public.checkout_quotes (id, cart_owner_hash, locale, lines, price_fingerprint, config_version,
      subtotal_cents, total_cents, expires_at, shipping_country, shipping_postal_code, vat_regime)
    values (${quoteId}, ${owner}, 'es', '[]', 'fp', 1, ${total}, ${total}, now() + interval '1 hour', 'ES', ${postal},
      public.vat_regime('ES', ${postal}))`;
  await db.run`
    insert into public.orders (id, reference, locale, subtotal_cents, total_cents, access_token_hash, payment_status,
      shipping_country, shipping_postal_code, vat_regime, stripe_session_id)
    values (${orderId}, ${`PD-T${orderId.slice(0, 8)}`}, 'es', ${total}, ${total}, 'hash', 'checkout_open',
      'ES', ${postal}, public.vat_regime('ES', ${postal}), ${sessionId})`;
  await db.run`
    insert into public.order_items (order_id, product_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents)
    values (${orderId}, ${productId}, 'Taza', ${sku}, ${total}, 1, ${total})`;
  await db.run`
    insert into public.checkout_attempts (id, order_id, cart_owner_hash, quote_id, request_hash, status,
      stripe_idempotency_key, stripe_session_id, created_at, session_expires_at)
    values (${attemptId}, ${orderId}, ${owner}, ${quoteId}, 'rh', ${opts.attemptStatus ?? 'session_open'},
      ${`checkout:${attemptId}`}, ${sessionId}, now() - ${opts.attemptAgo ?? '0 minutes'}::interval,
      now() + interval '30 minutes' - ${opts.sessionExpiresAgo ?? '0 minutes'}::interval)`;
  if (reserve) {
    await db.run`
      insert into public.stock_reservations (checkout_attempt_id, product_id, quantity, expires_at)
      values (${attemptId}, ${productId}, 1, now() + interval '30 minutes')`;
  }
  return { orderId, attemptId, productId, sessionId, quoteId };
}

export const stockOf = (db: Db, productId: string) =>
  db.one<{ stock_on_hand: number; stock_reserved: number }>`
    select stock_on_hand, stock_reserved from public.inventory where product_id = ${productId}`;
