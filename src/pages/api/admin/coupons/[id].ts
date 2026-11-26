import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { deleteCoupon, duplicateCoupon, setCouponStatus } from '@/lib/server/coupons';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

const patchSchema = z.union([
  z.object({ status: z.enum(['active', 'paused', 'archived']) }).strict(),
  z.object({ duplicate: z.literal(true) }).strict(),
]);

/** Pause, reactivate or archive a coupon, or copy it. */
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    const body = patchSchema.parse(await request.json());
    if ('duplicate' in body) {
      const copyId = await dbCall(() => duplicateCoupon(admin.db, id));
      await audit(admin, 'duplicate_coupon', 'coupons', copyId, { from: id });
      return Response.json({ ok: true, id: copyId });
    }
    await dbCall(() => setCouponStatus(admin.db, id, body.status));
    await audit(admin, 'set_coupon_status', 'coupons', id, { status: body.status });
    return Response.json({ ok: true, id });
  } catch (err) {
    return failure(err, 'No se pudo cambiar el cupón.');
  }
};

/** Delete a coupon nobody has used. */
export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const id = z.uuid().parse(params.id);
    await dbCall(() => deleteCoupon(admin.db, id));
    await audit(admin, 'delete_coupon', 'coupons', id, {});
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err, 'No se pudo borrar el cupón.');
  }
};
