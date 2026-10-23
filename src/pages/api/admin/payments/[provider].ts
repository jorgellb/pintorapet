import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import type { PaymentProvider } from '@/lib/server/payments/config';
import {
  connectPaypal,
  connectStripe,
  disconnectProvider,
  setProviderEnabled,
  setStripeWebhookSecret,
  type ProviderRow,
} from '@/lib/server/payments/connect';

export const prerender = false;

const stripeConnectSchema = z.object({
  secretKey: z.string().trim().min(10).max(255),
  webhookSecret: z.string().trim().max(255).optional(),
});

const paypalConnectSchema = z.object({
  mode: z.enum(['test', 'live']),
  clientId: z.string().trim().min(10).max(255),
  clientSecret: z.string().trim().min(10).max(255),
});

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    webhookSecret: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

function providerOf(value: string | undefined): PaymentProvider {
  if (value === 'stripe' || value === 'paypal') return value;
  throw new CommerceError('VALIDATION', 'Método de pago desconocido', 404);
}

function publicRow(row: ProviderRow | null) {
  if (!row) return null;
  return {
    provider: row.provider,
    enabled: row.enabled,
    mode: row.mode,
    accountLabel: row.account_label,
    keyHint: row.key_hint,
    webhook: Boolean(row.webhook_id || row.webhook_url),
    connectedAt: row.connected_at,
  };
}

function failure(err: unknown, fallback: string): Response {
  if (err instanceof CommerceError) return jsonError(err);
  if (err && typeof err === 'object' && 'issues' in err) {
    return jsonError(new CommerceError('VALIDATION', 'Revisa los datos del formulario.', 400));
  }
  console.error(fallback, err);
  return jsonError(new CommerceError('INTERNAL', fallback, 500));
}

type Admin = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;

async function audit(admin: Admin, operation: string, provider: PaymentProvider, change: Record<string, unknown>) {
  await admin.client.from('admin_audit_log').insert({
    actor_user_id: admin.user.id,
    operation,
    entity_type: 'payment_provider',
    entity_id: provider,
    change,
  });
}

export const POST: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const provider = providerOf(params.provider);
    const body = await request.json();
    const row = provider === 'stripe'
      ? await connectStripe(admin.client, stripeConnectSchema.parse(body))
      : await connectPaypal(admin.client, paypalConnectSchema.parse(body));
    await audit(admin, 'connect_payment_provider', provider, {
      mode: row?.mode,
      account: row?.account_label,
      keyHint: row?.key_hint,
      webhook: Boolean(row?.webhook_id),
    });
    return Response.json({ ok: true, provider: publicRow(row) });
  } catch (err) {
    return failure(err, 'No se pudo conectar el método de pago.');
  }
};

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const provider = providerOf(params.provider);
    const body = patchSchema.parse(await request.json());
    if (body.webhookSecret) {
      if (provider !== 'stripe') {
        throw new CommerceError('VALIDATION', 'Solo Stripe usa un secreto de webhook manual.', 400);
      }
      await setStripeWebhookSecret(admin.client, body.webhookSecret);
    }
    if (typeof body.enabled === 'boolean') {
      await setProviderEnabled(admin.client, provider, body.enabled);
    }
    await audit(admin, 'update_payment_provider', provider, {
      enabled: body.enabled,
      webhookSecret: body.webhookSecret ? 'actualizado' : undefined,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar el cambio.');
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const provider = providerOf(params.provider);
    await disconnectProvider(admin.client, provider);
    await audit(admin, 'disconnect_payment_provider', provider, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo desconectar.');
  }
};
