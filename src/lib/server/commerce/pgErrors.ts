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
  SHIPPING_TOO_HEAVY: { code: 'UNAVAILABLE', status: 409 },
  ZONE_NOT_FOUND: { code: 'UNAVAILABLE', status: 404 },
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
    return new CommerceError(MAP[code].code, code, MAP[code].status, {
      pg: message,
    });
  }
  return new CommerceError('INTERNAL', 'Database commerce error', 500, {
    pg: message,
  });
}
