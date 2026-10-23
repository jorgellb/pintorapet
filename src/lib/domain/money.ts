/** Integer cents only — never float arithmetic for money. */
export type MoneyCents = number & { readonly __brand: 'MoneyCents' };
export type CurrencyCode = 'EUR';

export function asCents(value: number): MoneyCents {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid money cents: ${value}`);
  }
  return value as MoneyCents;
}

export function addCents(a: MoneyCents, b: MoneyCents): MoneyCents {
  return asCents(a + b);
}

export function mulCents(unit: MoneyCents, qty: number): MoneyCents {
  if (!Number.isInteger(qty) || qty < 0) {
    throw new Error(`Invalid quantity: ${qty}`);
  }
  return asCents(unit * qty);
}

export function formatEur(
  cents: number,
  locale: 'en' | 'es',
): string {
  const amount = cents / 100;
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'symbol',
  }).format(amount);
}
