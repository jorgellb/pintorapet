import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const text = (max: number) => z.string().trim().max(max);

const settingsSchema = z
  .object({
    packagingGrams: z.number().int().min(0).max(5000),
    customsDescription: text(50),
    sender: z
      .object({
        name: text(50),
        company: text(50),
        address: text(100),
        locality: text(40),
        postalCode: z.union([z.literal(''), z.string().regex(/^\d{5}$/)]),
        phone: text(15),
        email: z.union([z.literal(''), z.email().max(50)]),
      })
      .strict(),
  })
  .strict();

export const PUT: APIRoute = async ({ request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const body = settingsSchema.parse(await request.json());
    const { data: current, error: readErr } = await admin.client
      .from('shop_settings')
      .select('shipping_config')
      .eq('id', 1)
      .maybeSingle();
    if (readErr) throw mapPgError(readErr);
    const next = { ...((current?.shipping_config as object | null) ?? {}), ...body };
    const { error } = await admin.client.from('shop_settings').update({ shipping_config: next }).eq('id', 1);
    if (error) throw mapPgError(error);
    await audit(admin, 'update_shipping_settings', 'shop_settings', '1', { packagingGrams: body.packagingGrams });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudieron guardar los datos de envío.');
  }
};
