import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderInvoicePdf } from '../src/lib/server/invoices/pdf';
import type { InvoiceRow } from '../src/lib/server/invoices/types';

export const sampleInvoice: InvoiceRow = {
  id: 'inv-1',
  order_id: 'order-1',
  kind: 'full',
  full_number: 'F2026-0001',
  issued_at: '2026-10-24T10:30:00+02:00',
  operation_date: '2026-10-24',
  issuer: {
    issuerName: 'Meili Stringfellow',
    issuerNif: '89890001K',
    issuerAddress: 'Calle del Estudio 3',
    issuerPostalCode: '28013',
    issuerCity: 'Madrid',
    issuerKind: 'autonomo',
  },
  customer: {
    taxId: '12345678Z',
    name: 'Ana García',
    address: 'Calle de la Paz 14, 3º B',
    postalCode: '46001',
    city: 'Valencia',
    country: 'ES',
  },
  lines: [
    { description: 'Taza Jack Russell Terrier', quantity: 1, unitNetCents: 826, vatRate: 21, baseCents: 826, vatCents: 173, totalCents: 999 },
    { description: 'Envío', quantity: 1, unitNetCents: 488, vatRate: 21, baseCents: 488, vatCents: 102, totalCents: 590 },
  ],
  breakdown: { '21': { base: 1314, vat: 275 } },
  base_cents: 1314,
  vat_cents: 275,
  total_cents: 1589,
  vat_regime: 'es_vat',
  exemption_note: null,
  locale: 'es',
  qr_url: 'https://example.invalid/qr',
  replaces_number: 'S2026-0001',
};

describe('renderInvoicePdf', () => {
  it('produces a one-page PDF titled with the invoice number', async () => {
    const bytes = await renderInvoicePdf(sampleInvoice, { verifactuEnabled: false });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Factura F2026-0001');
  });

  it('titles a rectifying invoice as such, with negative amounts', async () => {
    const rectifying: InvoiceRow = {
      ...sampleInvoice,
      kind: 'rectifying',
      full_number: 'R2026-0001',
      lines: [{ ...sampleInvoice.lines[0], quantity: -1, baseCents: -826, vatCents: -173, totalCents: -999 }],
      breakdown: { '21': { base: -826, vat: -173 } },
      base_cents: -826,
      vat_cents: -173,
      total_cents: -999,
      replaces_number: null,
      rectifies_number: 'F2026-0001',
      rectifies_issued_at: '2026-10-24T10:30:00+02:00',
      rectification_reason: 'Devolución de una taza',
    };
    const doc = await PDFDocument.load(await renderInvoicePdf(rectifying, { verifactuEnabled: false }));
    expect(doc.getTitle()).toBe('Factura rectificativa R2026-0001');
    const en = await PDFDocument.load(await renderInvoicePdf({ ...rectifying, locale: 'en' }, { verifactuEnabled: false }));
    expect(en.getTitle()).toBe('Corrective invoice R2026-0001');
  });

  it('copes with characters the standard fonts lack and with many lines', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ ...sampleInvoice.lines[0], description: `Pieza ${i} — 🐶 ✓` }));
    const bytes = await renderInvoicePdf({ ...sampleInvoice, lines, locale: 'en', customer: null }, { verifactuEnabled: false });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
