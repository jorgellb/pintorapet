import { z } from 'zod';

export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

export const cartStateSchema = z.object({
  version: z.literal(1),
  items: z.array(cartItemSchema).max(20),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type CartState = z.infer<typeof cartStateSchema>;

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
    quantity: Math.min(quantity, 20),
  }));
}
