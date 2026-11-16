import type { Db } from '@/lib/server/db';
import { z } from 'zod';
import { isValidSpanishTaxId } from '@/lib/domain/taxId';
import { dbCall } from '@/lib/server/commerce/pgErrors';
import { renderInvoicePdf } from './pdf';
import type { InvoiceRow } from './types';

/** Shop name and Veri*factu switch, read with whatever client can see shop_settings. */
async function pdfOptions(client: Db) {
  const data = await client
    .one<{ public_name: string | null; invoice_config: unknown }>`
      select public_name, invoice_config from public.shop_settings where id = 1`
    .catch(() => null);
  return {
    brand: String(data?.public_name ?? 'Pets Drawings'),
    verifactuEnabled: Boolean((data?.invoice_config as { verifactuEnabled?: boolean } | null)?.verifactuEnabled),
  };
}

export async function invoicePdfResponse(
  invoice: InvoiceRow,
  settingsClient: Db | null,
  disposition: 'inline' | 'attachment' = 'inline',
): Promise<Response> {
  const opts = settingsClient ? await pdfOptions(settingsClient) : { brand: 'Pets Drawings', verifactuEnabled: false };
  // The QR only prints once Veri*factu is switched on and a QR image is available.
  const bytes = await renderInvoicePdf(invoice, { ...opts, verifactuEnabled: false });
  return new Response(new Blob([bytes as BlobPart], { type: "application/pdf" }), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${invoice.full_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

/** The customer's own invoice (ownership is checked in SQL). */
export async function customerInvoice(client: Db, id: string): Promise<InvoiceRow | null> {
  return client.call<InvoiceRow | null>('customer_invoice', { p_invoice_id: id }).catch(() => null);
}

/**
 * One of an order's invoices for the admin: the one asked for (a rectifying
 * one, say), else the one that counts (the replacement when there is one).
 */
export async function adminCurrentInvoice(
  client: Db,
  orderId: string,
  invoiceId?: string | null,
): Promise<InvoiceRow | null> {
  const rows = await dbCall(() => client.rows<InvoiceRow>`
    select * from public.invoices where order_id = ${orderId} order by issued_at desc`);
  const originals = rows.filter((r) => !r.rectifies_invoice_id);
  const current = invoiceId
    ? (rows.find((r) => r.id === invoiceId) ?? null)
    : (originals.find((r) => r.replaces_invoice_id) ?? originals[0] ?? null);
  if (current?.replaces_invoice_id) {
    current.replaces_number = rows.find((r) => r.id === current.replaces_invoice_id)?.full_number ?? null;
  }
  if (current?.rectifies_invoice_id) {
    const rectified = rows.find((r) => r.id === current.rectifies_invoice_id);
    current.rectifies_number = rectified?.full_number ?? null;
    current.rectifies_issued_at = rectified?.issued_at ?? null;
  }
  return current;
}

export const invoiceConfigSchema = z
  .object({
    issuerName: z.string().trim().min(1).max(160),
    issuerNif: z.string().trim().min(8).max(20),
    issuerAddress: z.string().trim().min(1).max(200),
    issuerPostalCode: z.string().trim().min(1).max(12),
    issuerCity: z.string().trim().min(1).max(80),
    issuerKind: z.enum(['autonomo', 'sociedad']),
    simplifiedPrefix: z.string().regex(/^[A-Z]$/).default('S'),
    fullPrefix: z.string().regex(/^[A-Z]$/).default('F'),
    shippingVatRate: z.union([z.literal(21), z.literal(10), z.literal(4), z.literal(0)]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isValidSpanishTaxId(value.issuerNif)) {
      ctx.addIssue({ code: 'custom', path: ['issuerNif'], message: 'INVALID_TAX_ID' });
    }
    if (value.simplifiedPrefix === value.fullPrefix) {
      ctx.addIssue({ code: 'custom', path: ['fullPrefix'], message: 'SAME_PREFIX' });
    }
  });
