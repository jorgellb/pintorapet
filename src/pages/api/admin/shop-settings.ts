import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';

export const prerender = false;

const patchSchema = z
  .object({
    salesEnabled: z.boolean().optional(),
    paymentsEnabled: z.boolean().optional(),
    publicName: z.string().trim().min(1).max(120).optional(),
    taxPolicy: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const GET: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) {
      return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    }
    const { data, error } = await admin.client
      .from('shop_settings')
      .select(
        'public_name, sales_enabled, payments_enabled, tax_policy, config_version, cart_max_qty_per_line, cart_max_lines, cart_max_units, quote_ttl_seconds, reservation_minutes',
      )
      .eq('id', 1)
      .maybeSingle();
    if (error) throw mapPgError(error);
    return Response.json({ settings: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return jsonError(new CommerceError('INTERNAL', 'Settings load failed', 500));
  }
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) {
      return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    }
    const body = patchSchema.parse(await request.json());
    const patch: Record<string, unknown> = {};
    if (typeof body.salesEnabled === 'boolean') patch.sales_enabled = body.salesEnabled;
    if (typeof body.paymentsEnabled === 'boolean') {
      patch.payments_enabled = body.paymentsEnabled;
    }
    if (body.publicName) patch.public_name = body.publicName;
    if (body.taxPolicy) patch.tax_policy = body.taxPolicy;

    // Bump config_version when commercial switches change so quotes invalidate.
    if (
      typeof body.salesEnabled === 'boolean' ||
      typeof body.paymentsEnabled === 'boolean' ||
      body.taxPolicy
    ) {
      const { data: current } = await admin.client
        .from('shop_settings')
        .select('config_version')
        .eq('id', 1)
        .maybeSingle();
      patch.config_version = (current?.config_version ?? 1) + 1;
    }

    const { data, error } = await admin.client
      .from('shop_settings')
      .update(patch)
      .eq('id', 1)
      .select(
        'public_name, sales_enabled, payments_enabled, tax_policy, config_version',
      )
      .single();
    if (error) throw mapPgError(error);

    await admin.client.from('admin_audit_log').insert({
      actor_user_id: admin.user.id,
      operation: 'update_shop_settings',
      entity_type: 'shop_settings',
      entity_id: '1',
      change: patch,
    });

    return Response.json({ ok: true, settings: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid settings patch', 400, err),
      );
    }
    return jsonError(
      new CommerceError('INTERNAL', 'Settings update failed', 500),
    );
  }
};
