import type { CartItem } from '@/lib/domain/cart';

export const DESTINATION_STORAGE_KEY = 'petsdrawings.destination.v1';
export const DESTINATION_EVENT = 'petsdrawings:destination';

export interface Destination {
  country: string;
  postalCode: string;
}

export type ShippingEstimate =
  | {
      available: true;
      zoneName: string;
      delivery: string;
      shippingCents: number;
      shippingFormatted: string;
      freeOverCents: number | null;
      remainingForFreeCents: number | null;
      remainingForFreeFormatted: string | null;
    }
  | { available: false; reason: string };

export function needsPostalCode(country: string): boolean {
  return country.toUpperCase() === 'ES';
}

export function isCompleteDestination(dest: Destination | null): dest is Destination {
  if (!dest || !/^[A-Z]{2}$/.test(dest.country)) return false;
  return !needsPostalCode(dest.country) || /^\d{5}$/.test(dest.postalCode);
}

export function readDestination(): Destination | null {
  try {
    const raw = localStorage.getItem(DESTINATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Destination>;
    if (typeof parsed.country !== 'string') return null;
    return { country: parsed.country.toUpperCase(), postalCode: String(parsed.postalCode ?? '').trim() };
  } catch {
    return null;
  }
}

export function writeDestination(dest: Destination): void {
  const next = {
    country: dest.country.toUpperCase(),
    postalCode: needsPostalCode(dest.country) ? dest.postalCode.trim() : '',
  };
  try {
    localStorage.setItem(DESTINATION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the destination only lasts for this page.
  }
  window.dispatchEvent(new CustomEvent(DESTINATION_EVENT, { detail: next }));
}

const cache = new Map<string, Promise<ShippingEstimate>>();

/** One request per cart + destination, shared by every summary on the page. */
export function estimateShipping(
  locale: 'en' | 'es',
  items: CartItem[],
  dest: Destination,
): Promise<ShippingEstimate> {
  const key = JSON.stringify([locale, items, dest.country, dest.postalCode]);
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch('/api/shipping/estimate/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        locale,
        items,
        country: dest.country,
        postalCode: dest.postalCode || undefined,
      }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as ShippingEstimate;
    });
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}
