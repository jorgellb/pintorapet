import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { InvoiceRow } from './types';

const MM = 72 / 25.4;
const A4 = { width: 210 * MM, height: 297 * MM };
const MARGIN = 18 * MM;

const INK = rgb(0.086, 0.09, 0.102);
const SOFT = rgb(0.227, 0.239, 0.267);
const MUTED = rgb(0.373, 0.388, 0.424);
const LINE = rgb(0.85, 0.85, 0.83);
const ACCENT = rgb(0.173, 0.22, 0.329);

const TEXT = {
  es: {
    simplified: 'Factura simplificada',
    full: 'Factura',
    number: 'Número',
    issued: 'Fecha de expedición',
    operation: 'Fecha de operación',
    issuer: 'Emisor',
    customer: 'Cliente',
    taxId: 'NIF',
    description: 'Concepto',
    qty: 'Uds.',
    unit: 'Precio sin IVA',
    vat: 'IVA',
    total: 'Total',
    base: 'Base imponible',
    vatAmount: 'Cuota',
    grandTotal: 'Total factura',
    replaces: 'Sustituye a la factura simplificada',
    verifactu: 'Factura verificable en la sede electrónica de la AEAT',
  },
  en: {
    simplified: 'Simplified invoice',
    full: 'Invoice',
    number: 'Number',
    issued: 'Issue date',
    operation: 'Date of supply',
    issuer: 'Issued by',
    customer: 'Customer',
    taxId: 'Tax ID',
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit price excl. VAT',
    vat: 'VAT',
    total: 'Total',
    base: 'Taxable base',
    vatAmount: 'VAT',
    grandTotal: 'Invoice total',
    replaces: 'Replaces simplified invoice',
    verifactu: 'Invoice verifiable at the AEAT electronic office',
  },
} as const;

function money(cents: number, locale: 'en' | 'es'): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  })
    .format(cents / 100)
    .replace(/ /g, ' ');
}

function day(value: string, locale: 'en' | 'es'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date(value));
}

function rate(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} %`;
}

/** Standard fonts only know Latin-1 (WinAnsi): anything else becomes "?". */
function safe(font: PDFFont, text: string): string {
  return [...String(text ?? '')]
    .map((char) => {
      try {
        font.encodeText(char);
        return char;
      } catch {
        return '?';
      }
    })
    .join('');
}

/** Split a string so it fits a width, word by word. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = safe(font, text).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderInvoicePdf(
  invoice: InvoiceRow,
  opts: { verifactuEnabled: boolean; brand?: string; qrPng?: Uint8Array | null },
): Promise<Uint8Array> {
  const t = TEXT[invoice.locale === 'en' ? 'en' : 'es'];
  const locale = invoice.locale === 'en' ? 'en' : 'es';
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice.kind === 'full' ? t.full : t.simplified} ${invoice.full_number}`);
  doc.setAuthor(invoice.issuer.issuerName);
  doc.setCreator(opts.brand ?? 'Pets Drawings');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanItalic);

  let page: PDFPage = doc.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;
  const right = A4.width - MARGIN;
  const contentWidth = right - MARGIN;

  const text = (value: string, x: number, at: number, size: number, font = regular, color = INK) =>
    page.drawText(safe(font, value), { x, y: at, size, font, color });
  const textRight = (value: string, xRight: number, at: number, size: number, font = regular, color = INK) => {
    const clean = safe(font, value);
    page.drawText(clean, { x: xRight - font.widthOfTextAtSize(clean, size), y: at, size, font, color });
  };
  const rule = (at: number, color = LINE, thickness = 0.6) =>
    page.drawLine({ start: { x: MARGIN, y: at }, end: { x: right, y: at }, thickness, color });

  // ——— Header: the shop name and a fine line, then the title and number ———
  text(opts.brand ?? 'Pets Drawings', MARGIN, y - 4, 20, serif, INK);
  textRight(invoice.issuer.issuerName, right, y - 2, 9, regular, MUTED);
  y -= 16;
  rule(y, INK, 0.8);
  y -= 30;

  text(invoice.kind === 'full' ? t.full : t.simplified, MARGIN, y, 22, bold, INK);
  textRight(invoice.full_number, right, y, 18, bold, ACCENT);
  y -= 18;
  text(`${t.issued}: ${day(invoice.issued_at, locale)}`, MARGIN, y, 9, regular, MUTED);
  textRight(`${t.operation}: ${day(invoice.operation_date, locale)}`, right, y, 9, regular, MUTED);
  if (invoice.replaces_number) {
    y -= 13;
    text(`${t.replaces} ${invoice.replaces_number}`, MARGIN, y, 9, regular, ACCENT);
  }
  y -= 28;

  // ——— Parties ———
  const column = contentWidth / 2 - 6 * MM;
  const party = (title: string, lines: string[], x: number, top: number) => {
    let at = top;
    text(title.toUpperCase(), x, at, 7.5, bold, MUTED);
    at -= 13;
    for (const [i, line] of lines.entries()) {
      for (const part of wrap(i === 0 ? bold : regular, line, 10, column)) {
        text(part, x, at, 10, i === 0 ? bold : regular, i === 0 ? INK : SOFT);
        at -= 13;
      }
    }
    return at;
  };
  const issuer = invoice.issuer;
  const leftEnd = party(
    t.issuer,
    [
      issuer.issuerName,
      `${t.taxId}: ${issuer.issuerNif}`,
      issuer.issuerAddress,
      `${issuer.issuerPostalCode} ${issuer.issuerCity}`.trim(),
    ].filter(Boolean),
    MARGIN,
    y,
  );
  let rightEnd = y;
  if (invoice.customer) {
    const c = invoice.customer;
    rightEnd = party(
      t.customer,
      [c.name, `${t.taxId}: ${c.taxId}`, c.address, `${c.postalCode} ${c.city}`.trim(), c.country].filter(Boolean),
      MARGIN + contentWidth / 2 + 6 * MM,
      y,
    );
  }
  y = Math.min(leftEnd, rightEnd) - 18;

  // ——— Lines ———
  const cols = {
    description: MARGIN,
    qty: MARGIN + contentWidth * 0.55,
    unit: MARGIN + contentWidth * 0.72,
    vat: MARGIN + contentWidth * 0.82,
    total: right,
  };
  const header = () => {
    text(t.description.toUpperCase(), cols.description, y, 7.5, bold, MUTED);
    textRight(t.qty.toUpperCase(), cols.qty + 20, y, 7.5, bold, MUTED);
    textRight(t.unit.toUpperCase(), cols.unit + 28, y, 7.5, bold, MUTED);
    textRight(t.vat.toUpperCase(), cols.vat + 22, y, 7.5, bold, MUTED);
    textRight(t.total.toUpperCase(), cols.total, y, 7.5, bold, MUTED);
    y -= 8;
    rule(y);
    y -= 16;
  };
  header();

  for (const line of invoice.lines) {
    const parts = wrap(regular, line.description, 10, contentWidth * 0.5);
    const height = parts.length * 13 + 8;
    if (y - height < MARGIN + 120) {
      page = doc.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
      header();
    }
    parts.forEach((part, i) => text(part, cols.description, y - i * 13, 10, regular, INK));
    textRight(String(line.quantity), cols.qty + 20, y, 10);
    textRight(money(line.unitNetCents, locale), cols.unit + 28, y, 10);
    textRight(rate(line.vatRate), cols.vat + 22, y, 10, regular, SOFT);
    textRight(money(line.totalCents, locale), cols.total, y, 10);
    // a hairline under the row, halfway to the next one
    rule(y - (parts.length - 1) * 13 - 6, rgb(0.9, 0.9, 0.88), 0.4);
    y -= height;
  }

  // ——— Breakdown by VAT rate, then the total ———
  y -= 14;
  const sumsX = MARGIN + contentWidth * 0.5;
  const rates = Object.entries(invoice.breakdown).sort(([a], [b]) => Number(b) - Number(a));
  for (const [key, part] of rates) {
    text(`${t.base} (${rate(Number(key))})`, sumsX, y, 9.5, regular, SOFT);
    textRight(money(part.base, locale), right, y, 9.5, regular, INK);
    y -= 14;
    text(`${t.vatAmount} ${rate(Number(key))}`, sumsX, y, 9.5, regular, SOFT);
    textRight(money(part.vat, locale), right, y, 9.5, regular, INK);
    y -= 14;
  }
  y -= 4;
  page.drawLine({ start: { x: sumsX, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.8, color: INK });
  y -= 8;
  text(t.grandTotal, sumsX, y, 12, bold, INK);
  textRight(money(invoice.total_cents, locale), right, y, 16, bold, INK);
  y -= 30;

  if (invoice.exemption_note) {
    for (const part of wrap(regular, invoice.exemption_note, 9, contentWidth)) {
      text(part, MARGIN, y, 9, regular, SOFT);
      y -= 12;
    }
  }

  // ——— Veri*factu ———
  if (opts.verifactuEnabled && opts.qrPng) {
    const image = await doc.embedPng(opts.qrPng);
    const size = 30 * MM;
    page.drawImage(image, { x: MARGIN, y: MARGIN + 6, width: size, height: size });
    text('VERI*FACTU', MARGIN + size + 6 * MM, MARGIN + size - 6, 11, bold, INK);
    text(t.verifactu, MARGIN + size + 6 * MM, MARGIN + size - 22, 9, regular, SOFT);
  }

  // footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${invoice.full_number} · ${i + 1}/${pages.length}`;
    p.drawText(safe(regular, label), {
      x: right - regular.widthOfTextAtSize(safe(regular, label), 7.5),
      y: MARGIN / 2,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return doc.save();
}
