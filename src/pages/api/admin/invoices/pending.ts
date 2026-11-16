import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Issue every paid order's missing invoice, oldest first. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const data = await dbCall(() => admin.db.call<number>('admin_issue_pending_invoices'));
    await audit(admin, 'issue_pending_invoices', 'invoices', 'pending', { issued: data });
    return Response.json({ ok: true, issued: data });
  } catch (err) {
    return failure(err, 'No se pudieron emitir las facturas pendientes.');
  }
};
