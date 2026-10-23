import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Issue every paid order's missing invoice, oldest first. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { data, error } = await admin.client.rpc('admin_issue_pending_invoices');
    if (error) throw mapPgError(error);
    await audit(admin, 'issue_pending_invoices', 'invoices', 'pending', { issued: data });
    return Response.json({ ok: true, issued: data });
  } catch (err) {
    return failure(err, 'No se pudieron emitir las facturas pendientes.');
  }
};
