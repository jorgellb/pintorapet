import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { CommerceError, jsonError } from '@/lib/server/commerce/errors';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { adminCurrentInvoice, invoicePdfResponse } from '@/lib/server/invoices/serve';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** The order's invoice as a PDF; ?factura=<id> for another of its invoices (a rectifying one). */
export const GET: APIRoute = async ({ params, cookies, request, url }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const wanted = url.searchParams.get('factura');
    const invoiceId = wanted && /^[0-9a-f-]{36}$/i.test(wanted) ? wanted : null;
    const invoice = await adminCurrentInvoice(admin.client, String(params.id), invoiceId);
    if (!invoice) return jsonError(new CommerceError('UNAVAILABLE', 'Este pedido no tiene factura.', 404));
    return invoicePdfResponse(invoice, admin.client);
  } catch (err) {
    return failure(err, 'No se pudo abrir la factura.');
  }
};

/**
 * Issue what is pending now that the tax data is there: this order's invoice
 * and its rectifying invoices (and any other order's, in their order).
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const { data, error } = await admin.client.rpc('admin_issue_pending_invoices');
    if (error) throw mapPgError(error);
    await audit(admin, 'issue_invoice', 'orders', String(params.id), {});
    return Response.json({ ok: true, id: data });
  } catch (err) {
    return failure(err, 'No se pudo emitir la factura.');
  }
};
