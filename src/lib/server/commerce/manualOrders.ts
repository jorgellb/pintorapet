import type { Db } from '@/lib/server/db';
import { z } from 'zod';
import { CommerceError } from './errors';
import { mapPgError } from './pgErrors';

/**
 * Orders taken by phone and paid by bank transfer or Bizum (Admin › Pedidos › Nuevo
 * pedido). The database prices them like the web (admin_quote_manual_order),
 * creates them awaiting the transfer with their pieces reserved
 * (admin_create_manual_order) and, when the money arrives, consumes the stock,
 * issues the invoice and emails the customer (admin_mark_order_paid); see
 * supabase/migrations/20261125000001_manual_orders.sql.
 */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => value || undefined);

/** "4,90", "4.90", 4.9 → 490; empty → null (the zone's price). */
const euroCents = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === null || value === undefined) return null;
    const raw = typeof value === 'number' ? String(value) : value.trim().replace(/\s|€/g, '').replace(',', '.');
    if (raw === '') return null;
    const euros = Number(raw);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(euros) || euros > 1000) {
      ctx.addIssue({ code: 'custom', message: 'Envío no válido' });
      return z.NEVER;
    }
    return Math.round(euros * 100);
  });

const invoiceCustomerSchema = z
  .object({
    taxId: text(20),
    name: text(160),
    address: text(200),
    postalCode: text(12),
    city: text(100),
    country: text(2).transform((value) => value.toUpperCase()),
  })
  .strict();

export const manualOrderSchema = z
  .object({
    lines: z
      .array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(50),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase()),
    postalCode: text(12),
    locale: z.enum(['es', 'en']).default('es'),
    shipping: euroCents,
    customer: z.object({ name: text(160), email: optionalText(254), phone: optionalText(30) }).strict(),
    address: z
      .object({
        name: optionalText(160),
        line1: text(200),
        line2: optionalText(200),
        city: text(100),
        state: optionalText(100),
        note: optionalText(500),
      })
      .strict(),
    invoiceCustomer: invoiceCustomerSchema.optional().nullable(),
    paid: z.boolean().default(false),
    /** How the customer pays: bank transfer or Bizum. */
    method: z.enum(['transfer', 'bizum']).default('transfer'),
  })
  .strict()
  .transform(({ shipping, ...rest }) => ({ ...rest, shippingCents: shipping }));

export type ManualOrderInput = z.output<typeof manualOrderSchema>;

export type ManualOrderQuote = {
  lines: Array<{
    productId: string;
    sku: string;
    title: string;
    quantity: number;
    unitPriceCents: number;
    lineSubtotalCents: number;
    /** Pieces still free (null: made to order). */
    available: number | null;
  }>;
  subtotalCents: number;
  /** The zone's price, when the zone ships there. */
  shippingQuotedCents: number | null;
  /** Why the zone does not ship there, in Spanish. */
  shippingProblem: string | null;
  shippingCents: number | null;
  totalCents: number | null;
  noVat: boolean;
  zoneName: string | null;
  weightGrams: number | null;
};

const SHIPPING: Record<string, string> = {
  NO_ZONE: 'No se envía a esa dirección: ninguna zona de envío cubre ese país o código postal.',
  TOO_HEAVY: 'El pedido pesa más de lo que admite la zona de envío.',
  POSTAL_CODE_REQUIRED: 'Falta el código postal para calcular el envío.',
  NO_DESTINATION: 'Falta el país para calcular el envío.',
};

function shippingProblem(reason: string | null | undefined): string {
  return (reason && SHIPPING[reason]) || 'No se pudo calcular el envío.';
}

const KNOWN: Array<[string, string, number]> = [
  ['MANUAL_ORDER_EMPTY', 'Añade al menos un producto.', 400],
  ['MANUAL_ORDER_COUNTRY', 'Elige el país.', 400],
  ['MANUAL_ORDER_QUANTITY', 'Las cantidades van de 1 a 99.', 400],
  ['MANUAL_ORDER_SHIPPING', 'El precio del envío no es válido.', 400],
  ['MANUAL_ORDER_METHOD', 'Elige cómo paga: transferencia o Bizum.', 400],
  ['MANUAL_ORDER_NAME', 'Escribe el nombre de quien compra.', 400],
  ['MANUAL_ORDER_EMAIL', 'El email no es válido (o déjalo vacío).', 400],
  ['MANUAL_ORDER_ADDRESS', 'Falta la dirección: calle, código postal y ciudad.', 400],
  ['INVALID_TAX_ID', 'El NIF de la factura no es válido.', 400],
  ['INVALID_INVOICE_CUSTOMER', 'Completa los datos de la factura: nombre, dirección, código postal y ciudad.', 400],
  ['PRODUCT_UNAVAILABLE', 'Uno de los productos ya no está publicado.', 409],
  ['INVENTORY_UNVERIFIED', 'Uno de los productos no tiene el stock verificado. Revísalo en Stock.', 409],
];

function explain(err: unknown): CommerceError {
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  const stock = /INSUFFICIENT_STOCK:\s*(\S+)/.exec(message);
  if (stock) return new CommerceError('UNAVAILABLE', `No hay stock suficiente de ${stock[1]}.`, 409);
  const known = KNOWN.find(([code]) => message.includes(code));
  if (known) return new CommerceError('VALIDATION', known[1], known[2]);
  const shipping = /SHIPPING_([A-Z_]+)/.exec(message);
  if (shipping) {
    return new CommerceError('VALIDATION', `${shippingProblem(shipping[1])} Escribe el precio del envío a mano.`, 409);
  }
  return mapPgError(err);
}

async function rpc<T>(client: Db, name: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await client.call<T>(name, args);
  } catch (err) {
    throw explain(err);
  }
}

/** The order as the database reads it (snake_case, empty parts left out). */
function payload(input: ManualOrderInput) {
  const p: Record<string, unknown> = {
    lines: input.lines.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
    country: input.country,
    postal_code: input.postalCode,
    locale: input.locale,
    customer: input.customer,
    address: input.address,
    paid: input.paid,
    method: input.method,
  };
  if (input.shippingCents !== null) p.shipping_cents = input.shippingCents;
  if (input.invoiceCustomer) p.invoice_customer = input.invoiceCustomer;
  return p;
}

type QuoteRow = {
  lines: Array<{
    product_id: string;
    sku: string;
    title: string;
    quantity: number;
    unit_price_cents: number;
    line_subtotal_cents: number;
    available: number | null;
  }>;
  subtotal_cents: number;
  shipping_quoted_cents: number | null;
  shipping_reason: string | null;
  shipping_cents: number | null;
  total_cents: number | null;
  vat_regime: string;
  zone_name: string | null;
  weight_grams: number | null;
};

export async function quoteManualOrder(client: Db, input: ManualOrderInput): Promise<ManualOrderQuote> {
  const q = await rpc<QuoteRow>(client, 'admin_quote_manual_order', { p: payload(input) });
  return {
    lines: q.lines.map((line) => ({
      productId: line.product_id,
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      lineSubtotalCents: line.line_subtotal_cents,
      available: line.available,
    })),
    subtotalCents: q.subtotal_cents,
    shippingQuotedCents: q.shipping_quoted_cents,
    shippingProblem: q.shipping_quoted_cents === null ? shippingProblem(q.shipping_reason) : null,
    shippingCents: q.shipping_cents,
    totalCents: q.total_cents,
    noVat: q.vat_regime === 'no_vat',
    zoneName: q.zone_name,
    weightGrams: q.weight_grams,
  };
}

export async function createManualOrder(client: Db, input: ManualOrderInput): Promise<{ orderId: string; reference: string }> {
  const out = await rpc<{ order_id: string; reference: string }>(client, 'admin_create_manual_order', { p: payload(input) });
  return { orderId: out.order_id, reference: out.reference };
}
