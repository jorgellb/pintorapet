import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * What Meili prints for a parcel without Correos connected: an address label
 * (A6, to stick on the box and frank at the post office) and a packing slip
 * (A4, inside the box: the pieces, no prices, as it may be a gift).
 */

const MM = 72 / 25.4;
const INK = rgb(0.086, 0.09, 0.102);
const SOFT = rgb(0.227, 0.239, 0.267);
const MUTED = rgb(0.373, 0.388, 0.424);
const LINE = rgb(0.8, 0.8, 0.78);

export type PrintableAddress = {
  name?: string;
  line1?: string;
  line2?: string;
  postal_code?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
};

export type PrintableOrder = {
  reference: string;
  locale: 'es' | 'en';
  createdAt: string;
  weightGrams: number | null;
  note: string;
  address: PrintableAddress | null;
  items: Array<{ title: string; sku: string; quantity: number }>;
};

export type PrintableSender = {
  name?: string;
  company?: string;
  address?: string;
  postalCode?: string;
  locality?: string;
  phone?: string;
};

/** The lines still to send: each order line minus what was refunded. */
export function packingSlipLines(
  items: Array<{ id: string; title: string; sku: string; quantity: number }>,
  left: Array<{ order_item_id: string; quantity: number }> | null,
): Array<{ title: string; sku: string; quantity: number }> {
  const remaining = new Map((left ?? []).map((l) => [l.order_item_id, l.quantity]));
  return items
    .map((item) => ({ title: item.title, sku: item.sku, quantity: left ? (remaining.get(item.id) ?? 0) : item.quantity }))
    .filter((item) => item.quantity > 0);
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

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = safe(font, text).split(/\s+/).filter(Boolean);
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

const countryName = (code: string | undefined, locale: 'es' | 'en') => {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

const addressLines = (a: PrintableAddress, locale: 'es' | 'en') =>
  [
    a.line1,
    a.line2,
    [a.postal_code, a.city].filter(Boolean).join(' '),
    a.state && a.state !== a.city ? a.state : '',
    countryName(a.country, locale).toUpperCase(),
  ].filter((line): line is string => Boolean(line && line.trim()));

async function fonts(doc: PDFDocument) {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
}

function writer(page: PDFPage) {
  return (value: string, x: number, y: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(safe(font, value), { x, y, size, font, color });
}

/** A6 label: sender at the top, the customer's address large, the order at the foot. */
export async function renderAddressLabel(order: PrintableOrder, sender: PrintableSender, brand: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Etiqueta ${order.reference}`);
  doc.setCreator(brand);
  const { regular, bold } = await fonts(doc);
  const width = 105 * MM;
  const height = 148 * MM;
  const margin = 7 * MM;
  const page = doc.addPage([width, height]);
  const text = writer(page);
  const inner = width - 2 * margin;

  // ——— Sender ———
  let y = height - margin - 7;
  text('REMITENTE', margin, y, 6.5, bold, MUTED);
  y -= 11;
  const from = [
    sender.name || brand,
    sender.company,
    sender.address,
    [sender.postalCode, sender.locality].filter(Boolean).join(' '),
    sender.phone ? `Tel. ${sender.phone}` : '',
  ].filter((line): line is string => Boolean(line && line.trim()));
  for (const line of from) {
    for (const part of wrap(regular, line, 8, inner)) {
      text(part, margin, y, 8, regular, SOFT);
      y -= 10;
    }
  }
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: LINE });

  // ——— Recipient, in a frame ———
  const boxTop = y - 8;
  const boxBottom = margin + 22;
  page.drawRectangle({
    x: margin,
    y: boxBottom,
    width: inner,
    height: boxTop - boxBottom,
    borderColor: INK,
    borderWidth: 1.2,
  });
  let at = boxTop - 16;
  const pad = 4 * MM;
  text('DESTINATARIO', margin + pad, at, 7, bold, MUTED);
  at -= 20;
  const a = order.address ?? {};
  for (const part of wrap(bold, a.name || '—', 15, inner - 2 * pad)) {
    text(part, margin + pad, at, 15, bold, INK);
    at -= 19;
  }
  at -= 2;
  for (const line of addressLines(a, order.locale === 'en' ? 'en' : 'es')) {
    for (const part of wrap(regular, line, 12.5, inner - 2 * pad)) {
      text(part, margin + pad, at, 12.5, regular, INK);
      at -= 16;
    }
  }
  if (a.phone) {
    at -= 4;
    text(`Tel. ${a.phone}`, margin + pad, at, 10, regular, SOFT);
  }

  // ——— Foot: the order ———
  const foot = [`Pedido ${order.reference}`, order.weightGrams ? `${order.weightGrams} g` : ''].filter(Boolean).join(' · ');
  text(foot, margin, margin + 6, 8, regular, MUTED);
  return doc.save();
}

const SLIP = {
  es: {
    title: 'Albarán',
    order: 'Pedido',
    date: 'Fecha',
    to: 'Enviar a',
    piece: 'Pieza',
    ref: 'Referencia',
    qty: 'Uds.',
    note: 'Nota del pedido',
    thanks: 'Gracias por tu compra. Cada pieza nace de un retrato a lápiz hecho a mano.',
  },
  en: {
    title: 'Packing slip',
    order: 'Order',
    date: 'Date',
    to: 'Ship to',
    piece: 'Piece',
    ref: 'Reference',
    qty: 'Qty',
    note: 'Order note',
    thanks: 'Thank you for your order. Every piece starts as a hand-drawn pencil portrait.',
  },
} as const;

/** A4 packing slip: what is in the box (no prices) and a thank-you. */
export async function renderPackingSlip(order: PrintableOrder, brand: string): Promise<Uint8Array> {
  const locale = order.locale === 'en' ? 'en' : 'es';
  const t = SLIP[locale];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} ${order.reference}`);
  doc.setCreator(brand);
  const { regular, bold, serif } = await fonts(doc);
  const width = 210 * MM;
  const height = 297 * MM;
  const margin = 18 * MM;
  let page = doc.addPage([width, height]);
  let text = writer(page);
  const right = width - margin;
  const textRight = (value: string, xRight: number, y: number, size: number, font: PDFFont, color = INK) => {
    const clean = safe(font, value);
    page.drawText(clean, { x: xRight - font.widthOfTextAtSize(clean, size), y, size, font, color });
  };

  let y = height - margin;
  text(brand, margin, y - 4, 20, serif);
  y -= 16;
  page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 0.8, color: INK });
  y -= 30;
  text(t.title, margin, y, 22, bold);
  textRight(order.reference, right, y, 16, bold);
  y -= 16;
  const date = new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date(order.createdAt));
  text(`${t.order} ${order.reference} · ${t.date}: ${date}`, margin, y, 9, regular, MUTED);
  y -= 30;

  if (order.address) {
    text(t.to.toUpperCase(), margin, y, 7.5, bold, MUTED);
    y -= 14;
    text(order.address.name || '—', margin, y, 11, bold);
    y -= 14;
    for (const line of addressLines(order.address, locale)) {
      text(line, margin, y, 10, regular, SOFT);
      y -= 13;
    }
    y -= 16;
  }

  const qtyX = right;
  const refX = margin + (right - margin) * 0.62;
  const header = () => {
    text(t.piece.toUpperCase(), margin, y, 7.5, bold, MUTED);
    text(t.ref.toUpperCase(), refX, y, 7.5, bold, MUTED);
    textRight(t.qty.toUpperCase(), qtyX, y, 7.5, bold, MUTED);
    y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 0.6, color: LINE });
    y -= 18;
  };
  header();
  for (const item of order.items) {
    const parts = wrap(regular, item.title, 11, refX - margin - 12);
    if (y - parts.length * 14 < margin + 80) {
      page = doc.addPage([width, height]);
      text = writer(page);
      y = height - margin;
      header();
    }
    parts.forEach((part, i) => text(part, margin, y - i * 14, 11, regular));
    text(item.sku, refX, y, 9.5, regular, MUTED);
    textRight(String(item.quantity), qtyX, y, 11, bold);
    y -= parts.length * 14 + 10;
  }

  if (order.note.trim()) {
    y -= 10;
    text(t.note.toUpperCase(), margin, y, 7.5, bold, MUTED);
    y -= 14;
    for (const part of wrap(regular, order.note, 10, right - margin)) {
      text(part, margin, y, 10, regular, SOFT);
      y -= 13;
    }
  }

  // The thank-you sits at the foot of the last page.
  const thanks = wrap(serif, t.thanks, 13, right - margin);
  thanks.forEach((part, i) => text(part, margin, margin + 10 + (thanks.length - 1 - i) * 17, 13, serif, SOFT));
  return doc.save();
}
