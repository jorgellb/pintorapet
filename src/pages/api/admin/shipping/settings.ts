import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { dbCall } from '@/lib/server/commerce/pgErrors';
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
    const current = await dbCall(() => admin.db.one<{ shipping_config: unknown }>`
      select shipping_config from public.shop_settings where id = 1`);
    const next = { ...((current?.shipping_config as object | null) ?? {}), ...body };
    await dbCall(() => admin.db.run`update public.shop_settings set shipping_config = ${JSON.stringify(next)} where id = 1`);
    await audit(admin, 'update_shipping_settings', 'shop_settings', '1', { packagingGrams: body.packagingGrams });
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudieron guardar los datos de envío.');
  }
};
