import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { adminCurrentInvoice, invoicePdfResponse } from '@/lib/server/invoices/serve';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** The order's invoice as a PDF. */
export const GET: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const invoice = await adminCurrentInvoice(admin.client, String(params.id));
    if (!invoice) return jsonError(new CommerceError('UNAVAILABLE', 'Este pedido no tiene factura.', 404));
    return invoicePdfResponse(invoice, admin.client);
  } catch (err) {
    return failure(err, 'No se pudo abrir la factura.');
  }
};

/** Issue the invoice of a paid order that has none yet. */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { data, error } = await admin.client.rpc('admin_issue_invoice', { p_order_id: String(params.id) });
    if (error) throw mapPgError(error);
    await audit(admin, 'issue_invoice', 'orders', String(params.id), {});
    return Response.json({ ok: true, id: data });
  } catch (err) {
    return failure(err, 'No se pudo emitir la factura.');
  }
};
