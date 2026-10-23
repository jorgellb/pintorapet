import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isValidSpanishTaxId } from '@/lib/domain/taxId';
import { mapPgError } from '@/lib/server/commerce/pgErrors';
import { renderInvoicePdf } from './pdf';
import type { InvoiceRow } from './types';

/** Shop name and Veri*factu switch, read with whatever client can see shop_settings. */
async function pdfOptions(client: SupabaseClient) {
  const { data } = await client
    .from('shop_settings')
    .select('public_name, invoice_config')
    .eq('id', 1)
    .maybeSingle();
  return {
    brand: String(data?.public_name ?? 'Pets Drawings'),
    verifactuEnabled: Boolean((data?.invoice_config as { verifactuEnabled?: boolean } | null)?.verifactuEnabled),
  };
}

export async function invoicePdfResponse(
  invoice: InvoiceRow,
  settingsClient: SupabaseClient | null,
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
export async function customerInvoice(client: SupabaseClient, id: string): Promise<InvoiceRow | null> {
  const { data, error } = await client.rpc('customer_invoice', { p_invoice_id: id });
  if (error) return null;
  return data as InvoiceRow;
}

/** The invoice that counts for an order (the replacement when there is one). */
export async function adminCurrentInvoice(client: SupabaseClient, orderId: string): Promise<InvoiceRow | null> {
  const { data, error } = await client
    .from('invoices')
    .select('*')
    .eq('order_id', orderId)
    .order('issued_at', { ascending: false });
  if (error) throw mapPgError(error);
  const rows = (data ?? []) as InvoiceRow[];
  const current = rows.find((r) => r.replaces_invoice_id) ?? rows[0] ?? null;
  if (current?.replaces_invoice_id) {
    current.replaces_number = rows.find((r) => r.id === current.replaces_invoice_id)?.full_number ?? null;
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
