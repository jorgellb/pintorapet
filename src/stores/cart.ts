import {
  cartStateSchema,
  emptyCart,
  normalizeCartItems,
  type CartState,
} from '@/lib/domain/cart';

export const CART_STORAGE_KEY = 'petsdrawings.cart.v1';
export const CART_EVENT = 'petsdrawings:cart';
export const CART_OPEN_EVENT = 'petsdrawings:cart-open';

/** Asks the floating cart to slide in (no-op on pages without it). */
export function openCart(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT));
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function readCart(): CartState {
  if (!canUseStorage()) return emptyCart();
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = cartStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return emptyCart();
    return {
      version: 1,
      items: normalizeCartItems(parsed.data.items),
    };
  } catch {
    return emptyCart();
  }
}

export function writeCart(cart: CartState): CartState {
  const next: CartState = {
    version: 1,
    items: normalizeCartItems(cart.items),
  };
  if (canUseStorage()) {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CART_EVENT));
  }
  return next;
}

export function addItem(productId: string, quantity = 1): CartState {
  const cart = readCart();
  const qty = Math.max(1, Math.min(20, Math.floor(quantity)));
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) {
    existing.quantity = Math.min(20, existing.quantity + qty);
  } else {
    cart.items.push({ productId, quantity: qty });
  }
  return writeCart(cart);
}

/** Alias used by shop UI. */
export const addToCart = addItem;

export function setQuantity(productId: string, quantity: number): CartState {
  const cart = readCart();
  if (quantity <= 0) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
  } else {
    const item = cart.items.find((i) => i.productId === productId);
    if (item) item.quantity = Math.min(20, Math.floor(quantity));
    else cart.items.push({ productId, quantity: Math.min(20, Math.floor(quantity)) });
  }
  return writeCart(cart);
}

export function removeFromCart(productId: string): CartState {
  return setQuantity(productId, 0);
}

export function cartCount(cart: CartState = readCart()): number {
  return cart.items.reduce((n, i) => n + i.quantity, 0);
}

export const cartUnitCount = cartCount;
