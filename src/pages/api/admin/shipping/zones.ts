import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const zoneSchema = z
  .object({
    zone: z
      .object({
        id: z.uuid().optional(),
        nameEs: z.string().trim().min(1).max(80),
        nameEn: z.string().trim().min(1).max(80),
        kind: z.enum(['national', 'international']),
        countries: z.array(z.string().regex(/^([A-Za-z]{2}|\*)$/)).min(1).max(250),
        regions: z.array(z.enum(['peninsula', 'baleares', 'canarias', 'ceuta', 'melilla'])).max(5),
        active: z.boolean(),
        freeOverCents: z.number().int().positive().max(10_000_00).nullable(),
        deliveryEs: z.string().trim().max(80),
        deliveryEn: z.string().trim().max(80),
        correosProduct: z.string().trim().max(10).nullable(),
        customs: z.boolean(),
      })
      .strict(),
    rates: z
      .array(
        z
          .object({
            maxGrams: z.number().int().positive().max(30_000),
            priceCents: z.number().int().min(0).max(1_000_00),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine((v) => !v.zone.countries.map((c) => c.toUpperCase()).includes('ES') || v.zone.regions.length > 0, {
    message: 'Elige al menos una región de España.',
  })
  .refine((v) => new Set(v.rates.map((r) => r.maxGrams)).size === v.rates.length, {
    message: 'Cada tramo necesita un peso máximo distinto.',
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const body = zoneSchema.parse(await request.json());
    const { data, error } = await admin.client.rpc('admin_save_shipping_zone', {
      p_zone: body.zone,
      p_rates: body.rates,
    });
    if (error) throw mapPgError(error);
    const id = String(data);
    await audit(admin, body.zone.id ? 'update_shipping_zone' : 'create_shipping_zone', 'shipping_zones', id, body);
    return Response.json({ ok: true, id });
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      const issue = (err as { issues: Array<{ message: string; code: string }> }).issues.find((i) => i.code === 'custom');
      if (issue) return Response.json({ error: { code: 'VALIDATION', message: issue.message } }, { status: 400 });
    }
    return failure(err, 'No se pudo guardar la zona.');
  }
};
