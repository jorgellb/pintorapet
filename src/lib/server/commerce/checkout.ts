import { createHash, randomBytes } from 'node:crypto';
import { json, setColumns, type Db } from '@/lib/server/db';
import type Stripe from 'stripe';
import type { CartItem } from '@/lib/domain/cart';
import {
  buyerName,
  destinationMatches,
  shippingAddressFrom,
  type CheckoutCustomer,
} from '@/lib/domain/checkoutCustomer';
import { siteUrl } from '@/lib/server/env';
import { loadPaymentConfig, type PaymentProvider } from '@/lib/server/payments/config';
import { approveUrl, createPaypalOrder } from '@/lib/server/payments/paypal';
import { CommerceError } from './errors';
import { COUPON_WHO_REASONS, couponMessage, isCouponReason } from '@/lib/domain/coupons';
import { dbCall, mapPgError } from './pgErrors';
import { stripeFor } from './stripeClient';
import { releaseLapsedCheckouts } from './lapsed';

function requestHash(input: {
  quoteId: string;
  attemptId: string;
  cartOwnerHash: string;
  items?: CartItem[];
}): string {
  const payload = JSON.stringify({
    quoteId: input.quoteId,
    attemptId: input.attemptId,
    cartOwnerHash: input.cartOwnerHash,
    items: (input.items ?? [])
      .map((i) => `${i.productId}:${i.quantity}`)
      .sort(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

type ReserveResult = {
  attempt_id: string;
  order_id: string;
  reference?: string;
  status: string;
  expires_at?: string;
  total_cents?: number;
  currency?: string;
  locale?: 'en' | 'es';
  replay?: boolean;
};

type QuoteLine = {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  title?: string;
  sku?: string;
};

type Quote = {
  lines: QuoteLine[];
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  shipping_country: string | null;
  shipping_postal_code: string | null;
  shipping_zone_name: string | null;
  pickup_market_id: string | null;
};

export function checkoutPaths(locale: 'en' | 'es') {
  return {
    success: locale === 'es' ? '/es/compra/confirmacion/' : '/en/checkout/success/',
    cancel: locale === 'es' ? '/es/compra/cancelada/' : '/en/checkout/cancel/',
  };
}

export async function createCheckout(
  supabase: Db,
  opts: {
    provider: PaymentProvider;
    quoteId: string;
    attemptId: string;
    cartOwnerHash: string;
    locale: 'en' | 'es';
    items?: CartItem[];
    /** Contact and address typed on our checkout form. */
    customer?: CheckoutCustomer;
    /** Signed-in customer placing the order. */
    customerId?: string;
    /** That customer's account email, from the session (never from the request body). */
    customerEmail?: string;
  },
): Promise<{
  url: string;
  sessionId: string;
  orderId: string;
  reference?: string;
  accessToken: string;
}> {
  const payments = await loadPaymentConfig();
  const stripe = opts.provider === 'stripe' && payments.stripe?.enabled ? payments.stripe : null;
  const paypal = opts.provider === 'paypal' && payments.paypal?.enabled ? payments.paypal : null;
  if (!stripe && !paypal) {
    throw new CommerceError('NOT_CONFIGURED', 'Payment provider not connected', 503);
  }

  // Checkouts whose time is up give their stock back first (the ones Stripe
  // has to confirm are left to the cart and the cron, so this does not wait).
  await releaseLapsedCheckouts(supabase, { askStripe: false }).catch((err: unknown) =>
    console.error('[checkout] lapsed checkouts not released', err),
  );

  const quote = await dbCall(() => supabase.one<Quote>`
    select lines, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_country, shipping_postal_code,
           shipping_zone_name, pickup_market_id
    from public.checkout_quotes where id = ${opts.quoteId}`);
  if (!quote) {
    throw new CommerceError('UNAVAILABLE', 'QUOTE_NOT_FOUND', 404);
  }

  // The address must sit in the destination the shipping price was quoted for.
  if (
    opts.customer &&
    !destinationMatches(opts.customer, {
      country: quote.shipping_country,
      postalCode: quote.shipping_postal_code,
      pickupMarketId: quote.pickup_market_id,
    })
  ) {
    throw new CommerceError('VALIDATION', 'ADDRESS_DESTINATION_MISMATCH', 400);
  }

  const hash = requestHash(opts);
  const idempotencyKey = `checkout:${opts.attemptId}`;

  // This cart's earlier checkouts end first, so their pieces (a unique one the
  // same person reserved a minute ago, say) can be reserved again here.
  const stripeKey = payments.stripe?.secretKey;
  await releaseOwnerOpenOrders(
    supabase,
    opts.cartOwnerHash,
    opts.attemptId,
    stripeKey ? (sessionId) => stripeFor(stripeKey).checkout.sessions.expire(sessionId) : null,
  );

  const reserve = (
    await dbCall(() => supabase.one<{ result: ReserveResult }>`
      select public.reserve_checkout(
        p_attempt_id => ${opts.attemptId}, p_cart_owner_hash => ${opts.cartOwnerHash}, p_quote_id => ${opts.quoteId},
        p_request_hash => ${hash}, p_idempotency_key => ${idempotencyKey}) as result`)
  )?.result;
  if (!reserve?.order_id) {
    throw new CommerceError('INTERNAL', 'Reserve returned no order', 500);
  }

  const reference = reserve.reference ?? (await orderReference(supabase, reserve.order_id));

  if (opts.customer || opts.customerId) {
    // Saved before payment; apply_payment keeps it unless the provider sends its own.
    const patch = {
      ...(opts.customer
        ? {
            customer_email: opts.customer.email,
            customer_name: buyerName(opts.customer),
            shipping_address: JSON.stringify(shippingAddressFrom(opts.customer)),
            is_gift: opts.customer.gift,
            gift_message: opts.customer.gift && opts.customer.giftMessage ? opts.customer.giftMessage : null,
          }
        : {}),
      ...(opts.customerId ? { customer_id: opts.customerId } : {}),
    };
    await dbCall(() => supabase.run`
      update public.orders set ${setColumns(patch)}
      where id = ${reserve.order_id} and payment_status in ('pending_session', 'checkout_open')`);
  }

  await claimCoupon(
    supabase,
    reserve.order_id,
    opts.locale,
    ownEmail(opts.customerId ? opts.customerEmail : undefined, opts.customer?.email),
  );

  const opened = stripe
    ? await openStripe(supabase, stripe.secretKey, opts, reserve, quote, idempotencyKey)
    : await openPaypal(supabase, paypal!, opts, reserve.order_id, reference, quote, idempotencyKey);

  // Guest order token (plaintext once). Client should store before the redirect.
  const accessToken = randomBytes(24).toString('base64url');
  if (!reserve.replay) {
    await dbCall(() => supabase.run`
      select public.set_order_access_token(p_order_id => ${reserve.order_id}, p_access_token => ${accessToken})`);
  }

  return {
    url: opened.url,
    sessionId: opened.id,
    orderId: reserve.order_id,
    reference,
    accessToken: reserve.replay ? '' : accessToken,
  };
}

/**
 * True when the order's email is the signed-in account's own (case and spaces aside);
 * with no email typed, the account's is used. A guest has no account email: false.
 */
export function ownEmail(accountEmail: string | undefined, orderEmail: string | undefined): boolean {
  if (!accountEmail) return false;
  const norm = (email: string) => email.trim().toLowerCase();
  return !orderEmail || norm(orderEmail) === norm(accountEmail);
}

/**
 * Takes the order's coupon use now that its customer is known, before any
 * payment opens. A coupon that no longer holds cancels the order (its stock goes
 * back) and answers 409 with the reason; a replayed attempt already holds its use.
 * Only the customer whose own account email is on the order may learn whether it has
 * bought or is on a list: for any other email those reasons all become COUPON_EMAIL.
 */
export async function claimCoupon(
  supabase: Db,
  orderId: string,
  locale: 'en' | 'es',
  ownEmail: boolean,
): Promise<void> {
  try {
    await supabase.run`select public.claim_order_coupon(${orderId})`;
  } catch (err) {
    const mapped = mapPgError(err);
    if (!isCouponReason(mapped.message)) throw mapped;
    await supabase.run`select public.cancel_unpaid_order(${orderId})`.catch((cancelErr: unknown) =>
      console.error('[checkout] order not cancelled after a coupon refusal', orderId, cancelErr),
    );
    const reason = !ownEmail && COUPON_WHO_REASONS.includes(mapped.message) ? 'COUPON_EMAIL' : mapped.message;
    throw new CommerceError('CONFLICT', reason, 409, { couponMessage: couponMessage(reason, locale) });
  }
}

type ReleasedOrder = { order_id: string; stripe_session_id: string | null };

/**
 * Before a cart's new checkout reserves: its other unpaid shop orders (a
 * payment page left behind, «Pagar» pressed again) end as expired, so their
 * stock goes back on sale (and can be reserved again by this checkout) and
 * their coupon use no longer counts against it, and their open Stripe sessions
 * are expired too. A cart holds one checkout at a time; a retry of this very
 * checkout (keepAttemptId) keeps its order. Best effort: a failure is logged,
 * and the reservation and the coupon claim then judge as before. One of those
 * sessions paid anyway is a late payment (review).
 */
export async function releaseOwnerOpenOrders(
  supabase: Db,
  cartOwnerHash: string,
  keepAttemptId: string,
  expireSession: ((sessionId: string) => Promise<unknown>) | null,
): Promise<void> {
  let released: ReleasedOrder[];
  try {
    released =
      (await supabase.one<{ result: ReleasedOrder[] }>`
        select public.release_owner_open_orders(${cartOwnerHash}, ${keepAttemptId}) as result`)?.result ?? [];
  } catch (err) {
    console.error('[checkout] earlier orders of this cart not released', keepAttemptId, err);
    return;
  }
  for (const old of released) {
    if (!old.stripe_session_id || !expireSession) continue;
    await expireSession(old.stripe_session_id).catch((err: unknown) =>
      console.error('[checkout] Stripe session not expired', old.order_id, old.stripe_session_id, err),
    );
  }
}

/**
 * When a Stripe Checkout session ends, in Unix seconds: with the stock
 * reservation (and the coupon use it holds) instead of Stripe's default 24 h,
 * within Stripe's bounds (at least 30 min after creation, a minute added for
 * the clocks; at most 24 h). Taken from the attempt's reservation, so a
 * replayed attempt sends the same value under the same idempotency key.
 */
export function stripeSessionExpiry(reservedUntil: string | Date | null | undefined, nowMs: number): number {
  const now = Math.floor(nowMs / 1000);
  const earliest = now + 31 * 60;
  const latest = now + 24 * 60 * 60 - 60;
  const wanted = reservedUntil ? Math.floor(new Date(reservedUntil).getTime() / 1000) : Number.NaN;
  return Math.min(Math.max(Number.isFinite(wanted) ? wanted : earliest, earliest), latest);
}

async function orderReference(supabase: Db, orderId: string): Promise<string> {
  const row = await supabase.one<{ reference: string }>`select reference from public.orders where id = ${orderId}`;
  return String(row?.reference ?? '');
}

async function openStripe(
  supabase: Db,
  secretKey: string,
  opts: { attemptId: string; quoteId: string; locale: 'en' | 'es'; customer?: CheckoutCustomer },
  reserve: ReserveResult,
  quote: Quote,
  idempotencyKey: string,
): Promise<{ url: string; id: string }> {
  const stripe = stripeFor(secretKey);
  const origin = siteUrl();
  const paths = checkoutPaths(opts.locale);
  const shippingLabel = quote.shipping_zone_name || (opts.locale === 'es' ? 'Envío' : 'Shipping');
  // A replayed attempt brings no expiry of its own: the one it was reserved with.
  const reservedUntil =
    reserve.expires_at ??
    (await supabase.one<{ until: string | Date | null }>`
      select session_expires_at as until from public.checkout_attempts where id = ${opts.attemptId}`)?.until;

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      client_reference_id: reserve.order_id,
      success_url: `${origin}${paths.success}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${paths.cancel}`,
      // An abandoned session releases its stock and coupon use soon, not after a day.
      expires_at: stripeSessionExpiry(reservedUntil, Date.now()),
      locale: opts.locale === 'es' ? 'es' : 'en',
      line_items: [
        ...quote.lines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: 'eur',
            unit_amount: l.unit_price_cents,
            product_data: {
              name: l.title || l.product_id,
              metadata: { product_id: l.product_id },
            },
          },
        })),
        // Without Stripe's own address step, shipping travels as a line.
        ...(opts.customer && quote.shipping_cents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: 'eur',
                  unit_amount: quote.shipping_cents,
                  product_data: { name: shippingLabel },
                },
              },
            ]
          : []),
      ],
      ...(!opts.customer && quote.shipping_country
        ? {
            shipping_options: [
              {
                shipping_rate_data: {
                  type: 'fixed_amount' as const,
                  fixed_amount: { amount: quote.shipping_cents, currency: 'eur' },
                  display_name: shippingLabel,
                },
              },
            ],
          }
        : {}),
      ...(opts.customer
        ? {
            // Our form already has the address: Stripe only takes the payment.
            customer_email: opts.customer.email,
            payment_intent_data: {
              shipping: {
                name: opts.customer.name,
                phone: opts.customer.phone,
                address: {
                  line1: opts.customer.line1,
                  line2: opts.customer.line2 || undefined,
                  city: opts.customer.city,
                  state: shippingAddressFrom(opts.customer).state || undefined,
                  postal_code: opts.customer.postalCode,
                  country: opts.customer.country,
                },
              },
            },
          }
        : quote.shipping_country
          ? {
              shipping_address_collection: {
                allowed_countries: [
                  quote.shipping_country as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry,
                ],
              },
              phone_number_collection: { enabled: true },
            }
          : {}),
      metadata: {
        attempt_id: opts.attemptId,
        order_id: reserve.order_id,
        quote_id: opts.quoteId,
      },
    },
    { idempotencyKey },
  );

  if (!session.url) {
    throw new CommerceError('INTERNAL', 'Stripe session missing URL', 500);
  }

  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000).toISOString()
    : reserve.expires_at ?? new Date(Date.now() + 35 * 60_000).toISOString();

  const payload = { id: session.id, url: session.url, status: session.status, amount_total: session.amount_total };
  await dbCall(() => supabase.run`
    select * from public.attach_stripe_session(
      p_attempt_id => ${opts.attemptId}, p_stripe_session_id => ${session.id},
      p_stripe_payload => ${json(payload)}, p_session_expires_at => ${expiresAt}::timestamptz)`);

  return { url: session.url, id: session.id };
}

async function openPaypal(
  supabase: Db,
  creds: { mode: 'test' | 'live'; clientId: string; clientSecret: string },
  opts: { attemptId: string; locale: 'en' | 'es'; customer?: CheckoutCustomer },
  orderId: string,
  reference: string,
  quote: Quote,
  idempotencyKey: string,
): Promise<{ url: string; id: string }> {
  const origin = siteUrl();
  const settings = await supabase.one<{ public_name: string | null }>`
    select public_name from public.shop_settings where id = 1`;

  const order = await createPaypalOrder(
    creds,
    {
      orderId,
      reference,
      locale: opts.locale,
      brandName: String(settings?.public_name ?? 'Pets Drawings'),
      lines: quote.lines.map((l) => ({
        title: l.title || l.product_id,
        sku: l.sku,
        quantity: l.quantity,
        unitPriceCents: l.unit_price_cents,
      })),
      subtotalCents: quote.subtotal_cents,
      shippingCents: quote.shipping_cents,
      taxCents: quote.tax_cents,
      totalCents: quote.total_cents,
      customer: opts.customer
        ? {
            email: opts.customer.email,
            name: opts.customer.name,
            address: shippingAddressFrom(opts.customer),
            pickup: opts.customer.pickup,
          }
        : undefined,
      returnUrl: `${origin}/api/checkout/paypal/return/`,
      cancelUrl: `${origin}/api/checkout/paypal/cancel/`,
    },
    idempotencyKey,
  ).catch((err: unknown) => {
    throw new CommerceError('UNAVAILABLE', 'PayPal could not create the order', 502, err);
  });

  const url = approveUrl(order);
  if (!url) {
    throw new CommerceError('INTERNAL', 'PayPal order missing approval link', 500);
  }

  await dbCall(() => supabase.run`
    select * from public.attach_paypal_order(
      p_attempt_id => ${opts.attemptId}, p_paypal_order_id => ${order.id},
      p_payload => ${json({ id: order.id, status: order.status, url })})`);

  return { url, id: order.id };
}
