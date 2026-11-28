// The cart store loads this on every public page, so it stays free of zod.
// The server validates request bodies with cartItemSchema in
// src/lib/validation/checkout.ts, which uses the same limits.

export const CART_MAX_LINES = 20;
export const CART_MAX_QUANTITY = 20;

export type CartItem = { productId: string; quantity: number };
export type CartState = { version: 1; items: CartItem[] };

/** An RFC 9562 UUID, the same rule as zod's uuid(). */
const UUID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

function isProductId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function cartItem(value: unknown): CartItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const { productId, quantity } = value as Record<string, unknown>;
  if (!isProductId(productId)) return null;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
  if (quantity < 1 || quantity > CART_MAX_QUANTITY) return null;
  return { productId, quantity };
}

/** The saved cart, or null when anything in it is not a valid cart. */
export function parseCartState(value: unknown): CartState | null {
  if (typeof value !== 'object' || value === null) return null;
  const { version, items } = value as Record<string, unknown>;
  if (version !== 1 || !Array.isArray(items) || items.length > CART_MAX_LINES) return null;
  const parsed = items.map(cartItem);
  if (parsed.some((item) => item === null)) return null;
  return { version: 1, items: parsed as CartItem[] };
}

export function emptyCart(): CartState {
  return { version: 1, items: [] };
}

/** Merge duplicate product lines before quoting. */
export function normalizeCartItems(items: CartItem[]): CartItem[] {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  return [...map.entries()].map(([productId, quantity]) => ({
    productId,
    quantity: Math.min(quantity, CART_MAX_QUANTITY),
  }));
}
