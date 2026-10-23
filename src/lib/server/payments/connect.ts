import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { CommerceError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { stripeFor } from '@/lib/server/commerce/stripeClient';
import { siteUrl } from '@/lib/server/env';
import {
  clearPaymentConfigCache,
  loadPaymentConfig,
  stripeModeOf,
  type PaymentMode,
  type PaymentProvider,
} from './config';
import {
  createPaypalWebhook,
  deletePaypalWebhook,
  listPaypalWebhooks,
  PaypalApiError,
  paypalToken,
  type PaypalCredentials,
} from './paypal';

const STRIPE_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
];
const WEBHOOK_TAG = 'pets-drawings-admin';

export type ProviderRow = {
  provider: PaymentProvider;
  enabled: boolean;
  mode: PaymentMode;
  account_id: string | null;
  account_label: string | null;
  key_hint: string | null;
  public_key: string | null;
  webhook_id: string | null;
  webhook_url: string | null;
  connected_at: string;
};

/** Stripe and PayPal only deliver webhooks to public https addresses. */
export function publicWebhookBase(): string | null {
  const origin = siteUrl();
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(url.hostname)) return null;
    return origin;
  } catch {
    return null;
  }
}

export function webhookUrlFor(provider: PaymentProvider): string {
  return `${siteUrl()}/api/webhooks/${provider}/`;
}

function hint(value: string): string {
  return value.length <= 12 ? '••••' : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

async function currentRow(client: SupabaseClient, provider: PaymentProvider): Promise<ProviderRow | null> {
  const { data, error } = await client
    .from('payment_providers')
    .select('*')
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw mapPgError(error);
  return data as ProviderRow | null;
}

async function save(
  client: SupabaseClient,
  provider: PaymentProvider,
  settings: Record<string, unknown>,
  secrets: Record<string, string | null>,
) {
  const { error } = await client.rpc('admin_connect_payment_provider', {
    p_provider: provider,
    p_settings: settings,
    p_secrets: secrets,
  });
  if (error) throw mapPgError(error);
  clearPaymentConfigCache();
}

export async function listProviderRows(client: SupabaseClient): Promise<ProviderRow[]> {
  const { data, error } = await client.from('payment_providers').select('*');
  if (error) throw mapPgError(error);
  return (data ?? []) as ProviderRow[];
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

function stripeAccountLabel(account: Stripe.Account): string {
  return (
    account.settings?.dashboard?.display_name ||
    account.business_profile?.name ||
    account.email ||
    account.id
  );
}

/** Restricted keys may lack account access; a balance read still proves the key works. */
async function currentStripeAccount(stripe: Stripe): Promise<{ id: string | null; label: string; chargesEnabled?: boolean }> {
  try {
    const account = await stripe.accounts.retrieveCurrent();
    return { id: account.id, label: stripeAccountLabel(account), chargesEnabled: account.charges_enabled };
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripePermissionError)) throw err;
    await stripe.balance.retrieve();
    return { id: null, label: 'Cuenta de Stripe' };
  }
}

async function replaceStripeWebhook(stripe: Stripe, previousId: string | null): Promise<{ id: string; secret: string; url: string }> {
  const url = webhookUrlFor('stripe');
  if (previousId) await stripe.webhookEndpoints.del(previousId).catch(() => undefined);
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const endpoint of existing.data) {
    if (endpoint.url === url && endpoint.metadata?.created_by === WEBHOOK_TAG) {
      await stripe.webhookEndpoints.del(endpoint.id).catch(() => undefined);
    }
  }
  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: STRIPE_EVENTS,
    description: 'Pets Drawings: pedidos de la tienda',
    metadata: { created_by: WEBHOOK_TAG },
  });
  if (!created.secret) throw new CommerceError('INTERNAL', 'Stripe no devolvió el secreto del webhook.', 502);
  return { id: created.id, secret: created.secret, url };
}

export async function connectStripe(
  client: SupabaseClient,
  input: { secretKey: string; webhookSecret?: string },
): Promise<ProviderRow | null> {
  const secretKey = input.secretKey.trim();
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    throw new CommerceError(
      'VALIDATION',
      'La clave debe empezar por sk_live_ o sk_test_ (o rk_ si es restringida).',
      400,
    );
  }
  const stripe = stripeFor(secretKey);
  let account: { id: string | null; label: string };
  try {
    account = await currentStripeAccount(stripe);
  } catch (err) {
    const message = err instanceof Stripe.errors.StripeAuthenticationError
      ? 'Stripe no reconoce esta clave. Cópiala de nuevo desde el panel de Stripe.'
      : 'No se pudo comprobar la clave con Stripe.';
    throw new CommerceError('VALIDATION', message, 400);
  }

  const previous = await currentRow(client, 'stripe');
  let webhook: { id: string | null; secret: string | null; url: string | null } = {
    id: null,
    secret: input.webhookSecret?.trim() || null,
    url: input.webhookSecret ? webhookUrlFor('stripe') : null,
  };
  if (publicWebhookBase()) {
    try {
      webhook = await replaceStripeWebhook(stripe, previous?.webhook_id ?? null);
    } catch (err) {
      throw new CommerceError(
        'UNAVAILABLE',
        'La clave es válida, pero Stripe no dejó crear el webhook. Usa una clave secreta completa (sk_) o crea el webhook a mano.',
        502,
      );
    }
  }

  await save(
    client,
    'stripe',
    {
      mode: stripeModeOf(secretKey),
      accountId: account.id,
      accountLabel: account.label,
      keyHint: hint(secretKey),
      webhookId: webhook.id,
      webhookUrl: webhook.url,
    },
    { secret_key: secretKey, webhook_secret: webhook.secret },
  );
  return currentRow(client, 'stripe');
}

/** Manual webhook secret, for sites without a public address yet (e.g. `stripe listen`). */
export async function setStripeWebhookSecret(client: SupabaseClient, webhookSecret: string): Promise<void> {
  const secret = webhookSecret.trim();
  if (!/^whsec_[A-Za-z0-9]+$/.test(secret)) {
    throw new CommerceError('VALIDATION', 'El secreto del webhook empieza por whsec_.', 400);
  }
  const row = await currentRow(client, 'stripe');
  if (!row) throw new CommerceError('VALIDATION', 'Conecta Stripe primero.', 400);
  await save(
    client,
    'stripe',
    {
      mode: row.mode,
      accountId: row.account_id,
      accountLabel: row.account_label,
      webhookId: row.webhook_id,
      webhookUrl: webhookUrlFor('stripe'),
    },
    { webhook_secret: secret },
  );
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

async function replacePaypalWebhook(creds: PaypalCredentials, previousId: string | null): Promise<{ id: string; url: string }> {
  const url = webhookUrlFor('paypal');
  if (previousId) await deletePaypalWebhook(creds, previousId).catch(() => undefined);
  for (const hook of await listPaypalWebhooks(creds)) {
    if (hook.url === url) await deletePaypalWebhook(creds, hook.id).catch(() => undefined);
  }
  const created = await createPaypalWebhook(creds, url);
  return { id: created.id, url };
}

export async function connectPaypal(
  client: SupabaseClient,
  input: { mode: PaymentMode; clientId: string; clientSecret: string },
): Promise<ProviderRow | null> {
  const creds: PaypalCredentials = {
    mode: input.mode,
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret.trim(),
  };
  let appId: string | undefined;
  try {
    ({ appId } = await paypalToken(creds));
  } catch (err) {
    const where = input.mode === 'live' ? 'reales (Live)' : 'de pruebas (Sandbox)';
    throw new CommerceError(
      'VALIDATION',
      `PayPal no acepta estas credenciales ${where}. Revisa que el Client ID y el Secret sean de la misma app y del mismo modo.`,
      400,
    );
  }

  const previous = await currentRow(client, 'paypal');
  let webhook: { id: string | null; url: string | null } = { id: null, url: null };
  if (publicWebhookBase()) {
    try {
      webhook = await replacePaypalWebhook(creds, previous?.webhook_id ?? null);
    } catch (err) {
      const detail = err instanceof PaypalApiError ? ` (${err.message})` : '';
      throw new CommerceError(
        'UNAVAILABLE',
        `Las credenciales son válidas, pero PayPal no dejó crear el webhook${detail}.`,
        502,
      );
    }
  }

  await save(
    client,
    'paypal',
    {
      mode: input.mode,
      accountId: appId ?? null,
      accountLabel: appId ? `App ${appId}` : 'App de PayPal',
      keyHint: hint(creds.clientId),
      publicKey: creds.clientId,
      webhookId: webhook.id,
      webhookUrl: webhook.url,
    },
    { client_secret: creds.clientSecret },
  );
  return currentRow(client, 'paypal');
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export async function setProviderEnabled(client: SupabaseClient, provider: PaymentProvider, enabled: boolean): Promise<void> {
  const { error, count } = await client
    .from('payment_providers')
    .update({ enabled }, { count: 'exact' })
    .eq('provider', provider);
  if (error) throw mapPgError(error);
  if (!count) throw new CommerceError('VALIDATION', 'Ese método de pago no está conectado.', 400);
  clearPaymentConfigCache();
}

export async function disconnectProvider(client: SupabaseClient, provider: PaymentProvider): Promise<void> {
  clearPaymentConfigCache();
  const config = await loadPaymentConfig();
  const row = await currentRow(client, provider);
  if (row?.webhook_id) {
    if (provider === 'stripe' && config.stripe?.source === 'dashboard') {
      await stripeFor(config.stripe.secretKey).webhookEndpoints.del(row.webhook_id).catch(() => undefined);
    }
    if (provider === 'paypal' && config.paypal?.source === 'dashboard') {
      await deletePaypalWebhook(config.paypal, row.webhook_id).catch(() => undefined);
    }
  }
  const { error } = await client.rpc('admin_disconnect_payment_provider', { p_provider: provider });
  if (error) throw mapPgError(error);
  clearPaymentConfigCache();
}

export type ConnectionCheck = { ok: boolean; message: string };

export async function testProvider(provider: PaymentProvider): Promise<ConnectionCheck> {
  clearPaymentConfigCache();
  const config = await loadPaymentConfig();
  if (provider === 'stripe') {
    if (!config.stripe) return { ok: false, message: 'Stripe no está conectado.' };
    try {
      const stripe = stripeFor(config.stripe.secretKey);
      const account = await currentStripeAccount(stripe);
      const charges = account.chargesEnabled === false
        ? 'Stripe aún no permite cobrar: completa los datos de la cuenta en el panel de Stripe.'
        : 'La cuenta puede cobrar.';
      const hook = config.stripe.webhookSecret
        ? 'El webhook está configurado.'
        : 'Falta el webhook: los pagos no se confirmarán solos.';
      return {
        ok: account.chargesEnabled !== false && Boolean(config.stripe.webhookSecret),
        message: `Conexión correcta con ${account.label}. ${charges} ${hook}`,
      };
    } catch {
      return { ok: false, message: 'Stripe rechazó la clave guardada. Vuelve a conectarla.' };
    }
  }

  if (!config.paypal) return { ok: false, message: 'PayPal no está conectado.' };
  try {
    await paypalToken(config.paypal);
    const hook = config.paypal.webhookId
      ? 'El webhook está configurado.'
      : 'Sin webhook: el pago se confirma cuando el cliente vuelve a la web.';
    return { ok: true, message: `Conexión correcta con PayPal. ${hook}` };
  } catch {
    return { ok: false, message: 'PayPal rechazó las credenciales guardadas. Vuelve a conectarlas.' };
  }
}

