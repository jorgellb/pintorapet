import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { asUser } from '@/lib/server/db';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { forgetAnnouncedCoupon, saveCoupon } from '@/lib/server/coupons';
import { couponSchema } from '@/lib/domain/coupons';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Create a coupon, or change one (when the body has its id). */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const parsed = couponSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json(
        { error: { code: 'VALIDATION', message: issue?.message ?? 'Revisa los datos del cupón.' } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const id = await dbCall(() => asUser(admin.user.id, (tx) => saveCoupon(tx, input)));
    forgetAnnouncedCoupon();
    await audit(admin, input.id ? 'update_coupon' : 'create_coupon', 'coupons', id, input);
    return Response.json({ ok: true, id });
  } catch (err) {
    return failure(err, 'No se pudo guardar el cupón.');
  }
};
