import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/adminAuth';
import { dbCall } from '@/lib/server/commerce/pgErrors';
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
    const current = await dbCall(() => admin.db.one<{ invoice_config: unknown }>`
      select invoice_config from public.shop_settings where id = 1`);
    const next = {
      ...((current?.invoice_config as Record<string, unknown> | null) ?? {}),
      ...body,
      issuerNif: normalizeTaxId(body.issuerNif),
    };
    await dbCall(() => admin.db.run`update public.shop_settings set invoice_config = ${JSON.stringify(next)} where id = 1`);
    const complete = await admin.db.call<boolean>('invoice_config_complete').catch(() => false);
    await audit(admin, 'update_invoice_config', 'shop_settings', '1', { issuerNifEnd: next.issuerNif.slice(-3) });
    return Response.json({ ok: true, complete: Boolean(complete) });
  } catch (err) {
    return failure(err, 'No se pudieron guardar los datos fiscales.');
  }
};
