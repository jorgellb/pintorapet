import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const patchSchema = z.object({ active: z.boolean() }).strict();

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const id = z.uuid().parse(params.id);
    const body = patchSchema.parse(await request.json());
    const { error } = await admin.client.from('shipping_zones').update({ active: body.active }).eq('id', id);
    if (error) throw mapPgError(error);
    await audit(admin, 'update_shipping_zone', 'shipping_zones', id, body);
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo guardar la zona.');
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return forbidden();
    const id = z.uuid().parse(params.id);
    const { error } = await admin.client.from('shipping_zones').delete().eq('id', id);
    if (error) throw mapPgError(error);
    await audit(admin, 'delete_shipping_zone', 'shipping_zones', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar la zona.');
  }
};
