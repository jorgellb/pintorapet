export type InvoiceLine = {
  description: string;
  quantity: number;
  unitNetCents: number;
  vatRate: number;
  baseCents: number;
  vatCents: number;
  totalCents: number;
};

export type InvoiceIssuer = {
  issuerName: string;
  issuerNif: string;
  issuerAddress: string;
  issuerPostalCode: string;
  issuerCity: string;
  issuerKind?: string;
};

export type InvoiceCustomer = {
  taxId: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
};

/** A row of public.invoices, as stored (it never changes after issue). */
export type InvoiceRow = {
  id: string;
  order_id: string;
  kind: 'simplified' | 'full';
  full_number: string;
  issued_at: string;
  operation_date: string;
  issuer: InvoiceIssuer;
  customer: InvoiceCustomer | null;
  lines: InvoiceLine[];
  breakdown: Record<string, { base: number; vat: number }>;
  base_cents: number;
  vat_cents: number;
  total_cents: number;
  vat_regime: 'es_vat' | 'no_vat';
  exemption_note: string | null;
  locale: 'en' | 'es';
  qr_url: string;
  /** Set on a full invoice issued in place of a simplified one (Veri*factu F3). */
  replaces_invoice_id?: string | null;
  replaces_number?: string | null;
};
