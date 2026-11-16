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
  // Like the Supabase insert it replaces, a failed audit line never blocks the change itself.
  await admin.db
    .run`
      insert into public.admin_audit_log (actor_user_id, operation, entity_type, entity_id, change)
      values (${admin.user.id}, ${operation}, ${entityType}, ${entityId}, ${JSON.stringify(change)})`
    .catch((err: unknown) => console.error('[audit] not recorded', operation, err));
}
