import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { CartItem } from '@/lib/domain/cart';
import { siteUrl } from '@/lib/server/env';
import { loadPaymentConfig, type PaymentProvider } from '@/lib/server/payments/config';
import { approveUrl, createPaypalOrder } from '@/lib/server/payments/paypal';
import { CommerceError } from './errors';
import { mapPgError } from './pgErrors';
import { stripeFor } from './stripeClient';

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
  shipping_zone_name: string | null;
};

export function checkoutPaths(locale: 'en' | 'es') {
  return {
    success: locale === 'es' ? '/es/compra/confirmacion/' : '/en/checkout/success/',
    cancel: locale === 'es' ? '/es/compra/cancelada/' : '/en/checkout/cancel/',
  };
}

export async function createCheckout(
  supabase: SupabaseClient,
  opts: {
    provider: PaymentProvider;
    quoteId: string;
    attemptId: string;
    cartOwnerHash: string;
    locale: 'en' | 'es';
    items?: CartItem[];
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

  if (paypal) {
    await supabase.rpc('release_expired_paypal_attempts');
  }

  const hash = requestHash(opts);
  const idempotencyKey = `checkout:${opts.attemptId}`;

  const { data: reserveRaw, error: reserveErr } = await supabase.rpc(
    'reserve_checkout',
    {
      p_attempt_id: opts.attemptId,
      p_cart_owner_hash: opts.cartOwnerHash,
      p_quote_id: opts.quoteId,
      p_request_hash: hash,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (reserveErr) throw mapPgError(reserveErr);
  const reserve = reserveRaw as ReserveResult;
  if (!reserve?.order_id) {
    throw new CommerceError('INTERNAL', 'Reserve returned no order', 500);
  }

  const { data: quoteRow, error: quoteErr } = await supabase
    .from('checkout_quotes')
    .select('lines, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_country, shipping_zone_name')
    .eq('id', opts.quoteId)
    .maybeSingle();

  if (quoteErr) throw mapPgError(quoteErr);
  if (!quoteRow) {
    throw new CommerceError('UNAVAILABLE', 'QUOTE_NOT_FOUND', 404);
  }
  const quote = quoteRow as Quote;
  const reference = reserve.reference ?? (await orderReference(supabase, reserve.order_id));

  const opened = stripe
    ? await openStripe(supabase, stripe.secretKey, opts, reserve, quote, idempotencyKey)
    : await openPaypal(supabase, paypal!, opts, reserve.order_id, reference, quote, idempotencyKey);

  // Guest order token (plaintext once). Client should store before the redirect.
  const accessToken = randomBytes(24).toString('base64url');
  if (!reserve.replay) {
    const { error: tokenErr } = await supabase.rpc('set_order_access_token', {
      p_order_id: reserve.order_id,
      p_access_token: accessToken,
    });
    if (tokenErr) throw mapPgError(tokenErr);
  }

  return {
    url: opened.url,
    sessionId: opened.id,
    orderId: reserve.order_id,
    reference,
    accessToken: reserve.replay ? '' : accessToken,
  };
}

async function orderReference(supabase: SupabaseClient, orderId: string): Promise<string> {
  const { data } = await supabase.from('orders').select('reference').eq('id', orderId).maybeSingle();
  return String(data?.reference ?? '');
}

async function openStripe(
  supabase: SupabaseClient,
  secretKey: string,
  opts: { attemptId: string; quoteId: string; locale: 'en' | 'es' },
  reserve: ReserveResult,
  quote: Quote,
  idempotencyKey: string,
): Promise<{ url: string; id: string }> {
  const stripe = stripeFor(secretKey);
  const origin = siteUrl();
  const paths = checkoutPaths(opts.locale);

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      client_reference_id: reserve.order_id,
      success_url: `${origin}${paths.success}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${paths.cancel}`,
      locale: opts.locale === 'es' ? 'es' : 'en',
      line_items: quote.lines.map((l) => ({
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
      ...(quote.shipping_country
        ? {
            shipping_address_collection: {
              allowed_countries: [
                quote.shipping_country as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry,
              ],
            },
            shipping_options: [
              {
                shipping_rate_data: {
                  type: 'fixed_amount' as const,
                  fixed_amount: { amount: quote.shipping_cents, currency: 'eur' },
                  display_name:
                    quote.shipping_zone_name ||
                    (opts.locale === 'es' ? 'Envío' : 'Shipping'),
                },
              },
            ],
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

  const { error: attachErr } = await supabase.rpc('attach_stripe_session', {
    p_attempt_id: opts.attemptId,
    p_stripe_session_id: session.id,
    p_stripe_payload: {
      id: session.id,
      url: session.url,
      status: session.status,
      amount_total: session.amount_total,
    },
    p_session_expires_at: expiresAt,
  });
  if (attachErr) throw mapPgError(attachErr);

  return { url: session.url, id: session.id };
}

async function openPaypal(
  supabase: SupabaseClient,
  creds: { mode: 'test' | 'live'; clientId: string; clientSecret: string },
  opts: { attemptId: string; locale: 'en' | 'es' },
  orderId: string,
  reference: string,
  quote: Quote,
  idempotencyKey: string,
): Promise<{ url: string; id: string }> {
  const origin = siteUrl();
  const { data: settings } = await supabase
    .from('shop_settings')
    .select('public_name')
    .eq('id', 1)
    .maybeSingle();

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

  const { error: attachErr } = await supabase.rpc('attach_paypal_order', {
    p_attempt_id: opts.attemptId,
    p_paypal_order_id: order.id,
    p_payload: { id: order.id, status: order.status, url },
  });
  if (attachErr) throw mapPgError(attachErr);

  return { url, id: order.id };
}
