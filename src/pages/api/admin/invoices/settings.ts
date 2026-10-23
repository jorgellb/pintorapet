import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { invoiceConfigSchema } from '@/lib/server/invoices/serve';
import { normalizeTaxId } from '@/lib/domain/taxId';
import { audit, failure, forbidden } from '@/lib/server/shipping/http';

export const prerender = false;

/** Save the issuer's fiscal details used on every invoice. */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const admin = await requireAdmin(cookies, request);
  if (!admin) return forbidden();
  try {
    const body = invoiceConfigSchema.parse(await request.json());
    const { data: current, error: readErr } = await admin.client
      .from('shop_settings')
      .select('invoice_config')
      .eq('id', 1)
      .maybeSingle();
    if (readErr) throw mapPgError(readErr);
    const next = {
      ...((current?.invoice_config as Record<string, unknown> | null) ?? {}),
      ...body,
      issuerNif: normalizeTaxId(body.issuerNif),
    };
    const { error } = await admin.client.from('shop_settings').update({ invoice_config: next }).eq('id', 1);
    if (error) throw mapPgError(error);
    const { data: complete } = await admin.client.rpc('invoice_config_complete');
    await audit(admin, 'update_invoice_config', 'shop_settings', '1', { issuerNifEnd: next.issuerNif.slice(-3) });
    return Response.json({ ok: true, complete: Boolean(complete) });
  } catch (err) {
    return failure(err, 'No se pudieron guardar los datos fiscales.');
  }
};
