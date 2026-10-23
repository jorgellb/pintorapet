import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';

export type Admin = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;

export function failure(err: unknown, fallback: string): Response {
  if (err instanceof CommerceError) return jsonError(new CommerceError(err.code, err.message, err.status));
  if (err && typeof err === 'object' && 'issues' in err) {
    return jsonError(new CommerceError('VALIDATION', 'Revisa los datos del formulario.', 400));
  }
  console.error(fallback, err);
  return jsonError(new CommerceError('INTERNAL', fallback, 500));
}

export const forbidden = () => jsonError(new CommerceError('FORBIDDEN', 'Admin required', 403));

export async function audit(
  admin: Admin,
  operation: string,
  entityType: string,
  entityId: string,
  change: Record<string, unknown>,
) {
  await admin.client.from('admin_audit_log').insert({
    actor_user_id: admin.user.id,
    operation,
    entity_type: entityType,
    entity_id: entityId,
    change,
  });
}
