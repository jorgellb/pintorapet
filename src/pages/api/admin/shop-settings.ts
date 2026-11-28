import type { APIRoute } from 'astro';
import { audit } from '@/lib/server/shipping/http';
import { setColumns } from '@/lib/server/db';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';

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
    const data = await dbCall(() => admin.db.one`
      select public_name, sales_enabled, payments_enabled, tax_policy, config_version, cart_max_qty_per_line,
             cart_max_lines, cart_max_units, quote_ttl_seconds, reservation_minutes
      from public.shop_settings where id = 1`);
    return Response.json({ settings: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    return internalError(err, 'Settings load failed');
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
      const current = await admin.db.one<{ config_version: number }>`
        select config_version from public.shop_settings where id = 1`;
      patch.config_version = (current?.config_version ?? 1) + 1;
    }

    const data = await dbCall(() => admin.db.one`
      update public.shop_settings set ${setColumns(patch)} where id = 1
      returning public_name, sales_enabled, payments_enabled, tax_policy, config_version`);

    await audit(admin, 'update_shop_settings', 'shop_settings', '1', patch);

    return Response.json({ ok: true, settings: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(
        new CommerceError('VALIDATION', 'Invalid settings patch', 400, err),
      );
    }
    return internalError(err, 'Settings update failed');
  }
};
