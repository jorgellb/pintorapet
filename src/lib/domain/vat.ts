export const VAT_RATES = [21, 10, 4, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

/** Price without VAT from a VAT-inclusive price. Mirrors SQL `net_cents`. */
export function netCents(grossCents: number, rate: number): number {
  return Math.round(grossCents / (1 + rate / 100));
}

/** Splits a VAT-inclusive total into base and quota; they always add up to the total. */
export function splitGross(grossCents: number, rate: number): { baseCents: number; vatCents: number } {
  const baseCents = netCents(grossCents, rate);
  return { baseCents, vatCents: grossCents - baseCents };
}
