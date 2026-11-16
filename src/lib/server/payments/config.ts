import { serviceDb, sql } from '@/lib/server/db';

export type PaymentProvider = 'stripe' | 'paypal';
export type PaymentMode = 'test' | 'live';

export type StripeConfig = {
  source: 'dashboard' | 'env';
  enabled: boolean;
  mode: PaymentMode;
  secretKey: string;
  webhookSecret: string | null;
};

export type PaypalConfig = {
  source: 'dashboard' | 'env';
  enabled: boolean;
  mode: PaymentMode;
  clientId: string;
  clientSecret: string;
  webhookId: string | null;
};

export type PaymentConfig = { stripe: StripeConfig | null; paypal: PaypalConfig | null };

type ProviderRow = {
  provider: PaymentProvider;
  enabled: boolean;
  mode: PaymentMode;
  public_key: string | null;
  webhook_id: string | null;
};

const TTL_MS = 30_000;
let cache: { at: number; value: PaymentConfig } | null = null;

export function stripeModeOf(key: string): PaymentMode {
  return /^(sk|rk)_live_/.test(key) ? 'live' : 'test';
}

function fromEnv(): PaymentConfig {
  const env = import.meta.env;
  const stripeKey = env.STRIPE_SECRET_KEY as string | undefined;
  const paypalId = env.PAYPAL_CLIENT_ID as string | undefined;
  const paypalSecret = env.PAYPAL_CLIENT_SECRET as string | undefined;
  return {
    stripe: stripeKey
      ? {
          source: 'env',
          enabled: true,
          mode: stripeModeOf(stripeKey),
          secretKey: stripeKey,
          webhookSecret: (env.STRIPE_WEBHOOK_SECRET as string | undefined) || null,
        }
      : null,
    paypal:
      paypalId && paypalSecret
        ? {
            source: 'env',
            enabled: true,
            mode: env.PAYPAL_MODE === 'live' ? 'live' : 'test',
            clientId: paypalId,
            clientSecret: paypalSecret,
            webhookId: (env.PAYPAL_WEBHOOK_ID as string | undefined) || null,
          }
        : null,
  };
}

async function fromDashboard(): Promise<PaymentConfig> {
  const client = serviceDb();
  if (!client) return { stripe: null, paypal: null };
  const rows = await client
    .rows<ProviderRow>`select provider, enabled, mode, public_key, webhook_id from public.payment_providers`
    .catch(() => null);
  if (!rows) return { stripe: null, paypal: null };

  // Decrypting needs the vault key; without it (or on any error) the provider counts as not connected.
  const secretsOf = async (provider: PaymentProvider) => {
    const res = await client
      .withVaultKey<{ secrets: Record<string, string> | null }>(
        sql`select public.payment_provider_secrets(p_provider => ${provider}) as secrets`,
      )
      .catch(() => []);
    return res[0]?.secrets ?? {};
  };

  const config: PaymentConfig = { stripe: null, paypal: null };
  for (const row of rows) {
    const secrets = await secretsOf(row.provider);
    if (row.provider === 'stripe' && secrets.secret_key) {
      config.stripe = {
        source: 'dashboard',
        enabled: row.enabled,
        mode: row.mode,
        secretKey: secrets.secret_key,
        webhookSecret: secrets.webhook_secret || null,
      };
    }
    if (row.provider === 'paypal' && row.public_key && secrets.client_secret) {
      config.paypal = {
        source: 'dashboard',
        enabled: row.enabled,
        mode: row.mode,
        clientId: row.public_key,
        clientSecret: secrets.client_secret,
        webhookId: row.webhook_id,
      };
    }
  }
  return config;
}

/** Dashboard connections win; environment variables are the fallback. */
export async function loadPaymentConfig(): Promise<PaymentConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const dashboard = await fromDashboard().catch(() => ({ stripe: null, paypal: null }));
  const env = fromEnv();
  const value: PaymentConfig = {
    stripe: dashboard.stripe ?? env.stripe,
    paypal: dashboard.paypal ?? env.paypal,
  };
  cache = { at: Date.now(), value };
  return value;
}

export function clearPaymentConfigCache(): void {
  cache = null;
}

/** Providers the checkout may offer right now. */
export async function checkoutProviders(): Promise<PaymentProvider[]> {
  const config = await loadPaymentConfig();
  const list: PaymentProvider[] = [];
  if (config.stripe?.enabled) list.push('stripe');
  if (config.paypal?.enabled) list.push('paypal');
  return list;
}
