import { COUPON_REASONS } from '@/lib/domain/coupons';
import { CommerceError } from './errors';

const MAP: Record<string, { code: CommerceError['code']; status: number }> = {
  EMPTY_CART: { code: 'VALIDATION', status: 400 },
  INVALID_QUANTITY: { code: 'VALIDATION', status: 400 },
  INVALID_CART_OWNER: { code: 'VALIDATION', status: 400 },
  INVALID_ARGS: { code: 'VALIDATION', status: 400 },
  CART_TOO_MANY_LINES: { code: 'VALIDATION', status: 400 },
  CART_TOO_MANY_UNITS: { code: 'VALIDATION', status: 400 },
  PRODUCT_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  PRODUCT_UNAVAILABLE: { code: 'UNAVAILABLE', status: 409 },
  TRANSLATION_MISSING: { code: 'UNAVAILABLE', status: 409 },
  QUOTE_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  QUOTE_EXPIRED: { code: 'PRICE_CHANGED', status: 409 },
  QUOTE_OWNER_MISMATCH: { code: 'FORBIDDEN', status: 403 },
  PRICE_CHANGED: { code: 'PRICE_CHANGED', status: 409 },
  SALES_DISABLED: { code: 'UNAVAILABLE', status: 503 },
  INVENTORY_UNVERIFIED: { code: 'UNAVAILABLE', status: 409 },
  INSUFFICIENT_STOCK: { code: 'UNAVAILABLE', status: 409 },
  ATTEMPT_HASH_CONFLICT: { code: 'CONFLICT', status: 409 },
  ATTEMPT_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  SESSION_ALREADY_ATTACHED: { code: 'CONFLICT', status: 409 },
  ATTEMPT_NOT_ATTACHABLE: { code: 'CONFLICT', status: 409 },
  ORDER_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  NOT_SIGNED_IN: { code: 'FORBIDDEN', status: 401 },
  INVOICE_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  CUSTOMER_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  INVOICE_CONFIG_INCOMPLETE: { code: 'CONFLICT', status: 409 },
  INVOICE_ORDER_NOT_PAID: { code: 'CONFLICT', status: 409 },
  INVOICE_IMMUTABLE: { code: 'CONFLICT', status: 409 },
  INVALID_TAX_ID: { code: 'VALIDATION', status: 400 },
  INVALID_INVOICE_CUSTOMER: { code: 'VALIDATION', status: 400 },
  ORDER_NOT_PAYABLE: { code: 'CONFLICT', status: 409 },
  AMOUNT_MISMATCH: { code: 'CONFLICT', status: 409 },
  CURRENCY_MISMATCH: { code: 'VALIDATION', status: 400 },
  NOT_ADMIN: { code: 'FORBIDDEN', status: 403 },
  INVALID_STOCK: { code: 'VALIDATION', status: 400 },
  INVENTORY_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  STOCK_BELOW_RESERVED: { code: 'CONFLICT', status: 409 },
  INVALID_ACCESS_TOKEN: { code: 'VALIDATION', status: 400 },
  INVALID_LOOKUP: { code: 'VALIDATION', status: 400 },
  ORDER_LOOKUP_DENIED: { code: 'FORBIDDEN', status: 404 },
  SHIPPING_REQUIRED: { code: 'VALIDATION', status: 400 },
  SHIPPING_NO_DESTINATION: { code: 'VALIDATION', status: 400 },
  SHIPPING_POSTAL_CODE_REQUIRED: { code: 'VALIDATION', status: 400 },
  SHIPPING_NO_ZONE: { code: 'UNAVAILABLE', status: 409 },
  PICKUP_UNAVAILABLE: { code: 'UNAVAILABLE', status: 409 },
  COMMISSION_LINK_INVALID: { code: 'FORBIDDEN', status: 403 },
  COMMISSION_ALREADY_PAID: { code: 'CONFLICT', status: 409 },
  COMMISSION_NOT_PAYABLE: { code: 'UNAVAILABLE', status: 409 },
  MANUAL_ORDER_METHOD: { code: 'VALIDATION', status: 400 },
  SHIPPING_TOO_HEAVY: { code: 'UNAVAILABLE', status: 409 },
  ZONE_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  // A coupon that does not apply (the message is the reason), and one that cannot be deleted.
  ...Object.fromEntries(COUPON_REASONS.map((reason) => [reason, { code: 'CONFLICT', status: 409 }])),
  COUPON_IN_USE: { code: 'CONFLICT', status: 409 },
  // Reviews: any bad link says the same, whatever is wrong with it.
  REVIEW_LINK_INVALID: { code: 'FORBIDDEN', status: 403 },
  REVIEW_CLOSED: { code: 'CONFLICT', status: 409 },
  REVIEW_PRODUCT: { code: 'VALIDATION', status: 400 },
  REVIEW_PHOTOS_MAX: { code: 'VALIDATION', status: 400 },
  // Guest customers (Admin › Clientes): these have their own Spanish text, below.
  GUEST_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
  GUEST_INVALID_NAME: { code: 'VALIDATION', status: 400 },
  GUEST_INVALID_EMAIL: { code: 'VALIDATION', status: 400 },
  GUEST_INVALID_PHONE: { code: 'VALIDATION', status: 400 },
  GUEST_EMAIL_IS_ACCOUNT: { code: 'CONFLICT', status: 409 },
  CUSTOMER_HAS_DUE_ORDERS: { code: 'CONFLICT', status: 409 },
  CUSTOMER_HAS_UNINVOICED_ORDERS: { code: 'CONFLICT', status: 409 },
  CUSTOMER_HAS_UNFINISHED_ORDERS: { code: 'CONFLICT', status: 409 },
  // A payment under review (Admin › Pedidos).
  ORDER_NOT_IN_REVIEW: { code: 'CONFLICT', status: 409 },
  REVIEW_NOT_CONFIRMABLE: { code: 'CONFLICT', status: 409 },
  STOCK_UNAVAILABLE: { code: 'CONFLICT', status: 409 },
  INVOICE_DESTINATION_MISMATCH: { code: 'CONFLICT', status: 409 },
  DESTINATION_NOT_PENDING: { code: 'CONFLICT', status: 409 },
};

/** What Admin reads for the codes that have a sentence; any other code is its own message. */
export const dueOrdersMessage = (references: string) => `Tiene pedidos pendientes de cobrar o de enviar: ${references}`;

/** The references after «CODE: » in what PostgreSQL said. */
const refsAfter = (pg: string, code: string) => pg.slice(pg.indexOf(code) + code.length).replace(/^:\s*/, '').trim();

const TEXT: Record<string, (pg: string) => string> = {
  GUEST_NOT_FOUND: () => 'Ese cliente ya no tiene pedidos sin cuenta.',
  GUEST_INVALID_NAME: () => 'El nombre es obligatorio (hasta 120 letras).',
  GUEST_INVALID_EMAIL: () => 'Ese email no es válido.',
  GUEST_INVALID_PHONE: () => 'El teléfono es demasiado largo.',
  GUEST_EMAIL_IS_ACCOUNT: () => 'Ese email es de un cliente con cuenta: usa su ficha.',
  CUSTOMER_HAS_DUE_ORDERS: (pg) => dueOrdersMessage(refsAfter(pg, 'CUSTOMER_HAS_DUE_ORDERS')),
  // Charged, but the invoice was never issued: anonymizing would erase what it is issued from.
  CUSTOMER_HAS_UNINVOICED_ORDERS: (pg) =>
    `Tiene pedidos cobrados sin factura emitida: emítela desde el pedido («Emitir ahora» en Factura) o con «Emitir facturas pendientes» en Ajustes antes de borrar: ${refsAfter(pg, 'CUSTOMER_HAS_UNINVOICED_ORDERS')}`,
  // A checkout that never ended is not listed in the guest's record: it is deleted from Pedidos.
  CUSTOMER_HAS_UNFINISHED_ORDERS: (pg) =>
    `Tiene pedidos sin terminar (${refsAfter(pg, 'CUSTOMER_HAS_UNFINISHED_ORDERS')}): bórralos en Pedidos antes de borrar sus datos.`,
  ORDER_NOT_IN_REVIEW: () => 'Este pedido ya no está en revisión: recarga la página.',
  REVIEW_NOT_CONFIRMABLE: () =>
    'Este pago no se puede dar por bueno: devuélvelo desde Stripe o PayPal y cancela el pedido.',
  STOCK_UNAVAILABLE: () =>
    'No queda stock libre de alguna pieza: ajústalo en Productos o cancela el pedido y devuelve el pago.',
  INVOICE_DESTINATION_MISMATCH: () =>
    'La entrega está en otra zona que la del presupuesto: confirma el pago o usa «Facturar con la dirección de entrega».',
  DESTINATION_NOT_PENDING: () => 'Este pedido ya no tiene la dirección pendiente: recarga la página.',
};

function extractCode(message: string | undefined): string | null {
  if (!message) return null;
  const known = Object.keys(MAP).find((k) => message.includes(k));
  return known ?? null;
}

const UNIQUE: Array<[string, string]> = [
  ['products_sku_unique', 'Ese SKU ya lo usa otro producto.'],
  ['product_translations_locale_slug_unique', 'Esa dirección ya la usa otro producto.'],
  ['artworks_slug_en_unique', 'Esa dirección en inglés ya la usa otra ficha.'],
  ['artworks_slug_es_unique', 'Esa dirección ya la usa otra ficha.'],
  ['shop_collections_code_unique', 'Esa dirección ya la usa otra categoría.'],
  ['categories_code_unique', 'Esa dirección ya la usa otro tipo de producto.'],
  ['categories_slug_es_unique', 'Esa dirección ya la usa otro tipo de producto.'],
  ['categories_slug_en_unique', 'Esa dirección ya la usa otro tipo de producto.'],
  ['coupons_code_unique', 'Ya existe un cupón con ese código.'],
];

export function mapPgError(err: unknown): CommerceError {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const duplicate = UNIQUE.find(([constraint]) => message.includes(constraint));
  if (duplicate) {
    return new CommerceError('CONFLICT', duplicate[1], 409, { pg: message });
  }
  const code = extractCode(message);
  if (code && MAP[code]) {
    return new CommerceError(MAP[code].code, TEXT[code]?.(message) ?? code, MAP[code].status, {
      pg: message,
    });
  }
  return new CommerceError('INTERNAL', 'Database commerce error', 500, {
    pg: message,
  });
}

/** Runs database work, turning PostgreSQL errors into CommerceErrors (ones already mapped pass through). */
export async function dbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CommerceError) throw err;
    throw mapPgError(err);
  }
}
