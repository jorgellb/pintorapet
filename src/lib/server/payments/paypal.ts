import { CommerceError } from '@/lib/server/commerce/errors';
import type { PaymentMode } from './config';

export type PaypalCredentials = { mode: PaymentMode; clientId: string; clientSecret: string };

export type PaypalLink = { href: string; rel: string; method?: string };

export type PaypalCapture = {
  id: string;
  status: string;
  custom_id?: string;
  amount?: { currency_code: string; value: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
};

export type PaypalOrder = {
  id: string;
  status: string;
  links?: PaypalLink[];
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    shipping?: {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string;
        address_line_2?: string;
        admin_area_1?: string;
        admin_area_2?: string;
        postal_code?: string;
        country_code?: string;
      };
    };
    payments?: { captures?: PaypalCapture[] };
  }>;
};

export const PAYPAL_WEBHOOK_EVENTS = [
  'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
];

export function paypalBase(mode: PaymentMode): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

const tokens = new Map<string, { token: string; expiresAt: number; appId?: string }>();

export class PaypalApiError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'PaypalApiError';
  }
}

export async function paypalToken(
  creds: PaypalCredentials,
): Promise<{ token: string; appId?: string }> {
  const cacheKey = `${creds.mode}:${creds.clientId}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const res = await fetch(`${paypalBase(creds.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    app_id?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new PaypalApiError(res.status, null, body.error_description || 'PayPal rechazó las credenciales.');
  }
  const entry = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
    appId: body.app_id,
  };
  tokens.set(cacheKey, entry);
  return entry;
}

async function call<T>(
  creds: PaypalCredentials,
  method: string,
  path: string,
  body?: unknown,
  requestId?: string,
): Promise<T> {
  const { token } = await paypalToken(creds);
  const res = await fetch(`${paypalBase(creds.mode)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    details?: Array<{ issue?: string; description?: string }>;
  };
  if (!res.ok) {
    const detail = data.details?.[0];
    throw new PaypalApiError(
      res.status,
      detail?.issue ?? null,
      detail?.description || data.message || `PayPal respondió ${res.status}.`,
    );
  }
  return data as T;
}

const money = (cents: number) => ({ currency_code: 'EUR', value: (cents / 100).toFixed(2) });

export async function createPaypalOrder(
  creds: PaypalCredentials,
  input: {
    orderId: string;
    reference: string;
    locale: 'en' | 'es';
    brandName: string;
    lines: Array<{ title: string; sku?: string; quantity: number; unitPriceCents: number }>;
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    /** Address typed on our checkout form; PayPal then shows it instead of asking. */
    customer?: {
      email: string;
      name: string;
      address: {
        line1: string;
        line2: string;
        city: string;
        state: string;
        postal_code: string;
        country: string;
      };
    };
    returnUrl: string;
    cancelUrl: string;
  },
  requestId: string,
): Promise<PaypalOrder> {
  return call<PaypalOrder>(
    creds,
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          invoice_id: input.reference,
          description: `${input.brandName} ${input.reference}`.slice(0, 127),
          amount: {
            ...money(input.totalCents),
            breakdown: {
              item_total: money(input.subtotalCents),
              shipping: money(input.shippingCents),
              tax_total: money(input.taxCents),
            },
          },
          items: input.lines.map((line) => ({
            name: line.title.slice(0, 127),
            sku: line.sku?.slice(0, 127),
            quantity: String(line.quantity),
            unit_amount: money(line.unitPriceCents),
            category: 'PHYSICAL_GOODS',
          })),
          ...(input.customer
            ? {
                shipping: {
                  name: { full_name: input.customer.name.slice(0, 300) },
                  address: {
                    address_line_1: input.customer.address.line1.slice(0, 300),
                    ...(input.customer.address.line2
                      ? { address_line_2: input.customer.address.line2.slice(0, 300) }
                      : {}),
                    admin_area_2: input.customer.address.city.slice(0, 120),
                    ...(input.customer.address.state
                      ? { admin_area_1: input.customer.address.state.slice(0, 300) }
                      : {}),
                    postal_code: input.customer.address.postal_code.slice(0, 60),
                    country_code: input.customer.address.country,
                  },
                },
              }
            : {}),
        },
      ],
      payment_source: {
        paypal: {
          ...(input.customer ? { email_address: input.customer.email } : {}),
          experience_context: {
            brand_name: input.brandName.slice(0, 127),
            locale: input.locale === 'es' ? 'es-ES' : 'en-GB',
            user_action: 'PAY_NOW',
            shipping_preference: input.customer ? 'SET_PROVIDED_ADDRESS' : 'GET_FROM_FILE',
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
    requestId,
  );
}

export function approveUrl(order: PaypalOrder): string | null {
  return order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;
}

export async function getPaypalOrder(creds: PaypalCredentials, id: string): Promise<PaypalOrder> {
  return call<PaypalOrder>(creds, 'GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);
}

/** Captures an approved order; an order captured earlier is returned as is. */
export async function capturePaypalOrder(
  creds: PaypalCredentials,
  id: string,
  requestId: string,
): Promise<PaypalOrder> {
  try {
    return await call<PaypalOrder>(
      creds,
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      {},
      requestId,
    );
  } catch (err) {
    if (err instanceof PaypalApiError && err.issue === 'ORDER_ALREADY_CAPTURED') {
      return getPaypalOrder(creds, id);
    }
    throw err;
  }
}

export function firstCapture(order: PaypalOrder): PaypalCapture | null {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

export function centsOf(value: string | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

/** PayPal shipping in the same shape Stripe uses, so orders read the same. */
export function shippingOf(order: PaypalOrder): Record<string, string> | null {
  const address = order.purchase_units?.[0]?.shipping?.address;
  if (!address) return null;
  return {
    line1: address.address_line_1 ?? '',
    line2: address.address_line_2 ?? '',
    city: address.admin_area_2 ?? '',
    state: address.admin_area_1 ?? '',
    postal_code: address.postal_code ?? '',
    country: address.country_code ?? '',
    name: order.purchase_units?.[0]?.shipping?.name?.full_name ?? '',
  };
}

export function payerNameOf(order: PaypalOrder): string | null {
  const shipName = order.purchase_units?.[0]?.shipping?.name?.full_name;
  if (shipName) return shipName;
  const name = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(' ');
  return name || null;
}

export async function createPaypalWebhook(
  creds: PaypalCredentials,
  url: string,
): Promise<{ id: string }> {
  return call<{ id: string }>(creds, 'POST', '/v1/notifications/webhooks', {
    url,
    event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })),
  });
}

export async function listPaypalWebhooks(
  creds: PaypalCredentials,
): Promise<Array<{ id: string; url: string }>> {
  const data = await call<{ webhooks?: Array<{ id: string; url: string }> }>(
    creds,
    'GET',
    '/v1/notifications/webhooks',
  );
  return data.webhooks ?? [];
}

export async function deletePaypalWebhook(creds: PaypalCredentials, id: string): Promise<void> {
  await call<void>(creds, 'DELETE', `/v1/notifications/webhooks/${encodeURIComponent(id)}`);
}

export async function verifyPaypalWebhook(
  creds: PaypalCredentials,
  webhookId: string,
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const header = (name: string) => headers.get(name) ?? '';
  if (!header('paypal-transmission-id') || !header('paypal-transmission-sig')) {
    throw new CommerceError('VALIDATION', 'Missing PayPal signature headers', 400);
  }
  const result = await call<{ verification_status?: string }>(
    creds,
    'POST',
    '/v1/notifications/verify-webhook-signature',
    {
      auth_algo: header('paypal-auth-algo'),
      cert_url: header('paypal-cert-url'),
      transmission_id: header('paypal-transmission-id'),
      transmission_sig: header('paypal-transmission-sig'),
      transmission_time: header('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody) as unknown,
    },
  );
  return result.verification_status === 'SUCCESS';
}
