import type { APIRoute } from 'astro';
import { audit } from '@/lib/server/shipping/http';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, internalError, jsonError } from '@/lib/server/commerce/errors';
import { dbCall } from '@/lib/server/commerce/pgErrors';

export const prerender = false;

const patchSchema = z
  .object({
    status: z.enum(['received', 'reviewing', 'quoted', 'accepted', 'declined', 'closed']),
  })
  .strict();

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  try {
    const admin = await requireAdmin(cookies, request);
    if (!admin) return jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));
    const id = z.string().uuid().parse(params.id);
    const body = patchSchema.parse(await request.json());

    const data = await dbCall(() => admin.db.one`
      update public.commission_requests set status = ${body.status} where id = ${id} returning id, status`);
    if (!data) throw new CommerceError('UNAVAILABLE', 'Commission request not found', 404);

    await audit(admin, 'update_commission_status', 'commission_requests', id, body);

    return Response.json({ ok: true, commission: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid commission patch', 400, err));
    }
    return internalError(err, 'Commission update failed');
  }
};
