import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';

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

    const { data, error } = await admin.client
      .from('commission_requests')
      .update({ status: body.status })
      .eq('id', id)
      .select('id, status')
      .single();
    if (error) throw mapPgError(error);

    await admin.client.from('admin_audit_log').insert({
      actor_user_id: admin.user.id,
      operation: 'update_commission_status',
      entity_type: 'commission_requests',
      entity_id: id,
      change: body,
    });

    return Response.json({ ok: true, commission: data });
  } catch (err) {
    if (err instanceof CommerceError) return jsonError(err);
    if (err && typeof err === 'object' && 'issues' in err) {
      return jsonError(new CommerceError('VALIDATION', 'Invalid commission patch', 400, err));
    }
    return jsonError(new CommerceError('INTERNAL', 'Commission update failed', 500));
  }
};
