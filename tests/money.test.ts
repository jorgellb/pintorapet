import { describe, expect, it } from 'vitest';
import { addCents, asCents, formatEur, mulCents } from '@/lib/domain/money';
import { normalizeCartItems } from '@/lib/domain/cart';

describe('money', () => {
  it('rejects non-integer cents', () => {
    expect(() => asCents(3.5)).toThrow();
  });

  it('multiplies without floats', () => {
    expect(mulCents(asCents(349), 3)).toBe(1047);
  });

  it('adds cents', () => {
    expect(addCents(asCents(499), asCents(999))).toBe(1498);
  });

  it('formats EUR for locales', () => {
    const en = formatEur(349, 'en');
    const es = formatEur(349, 'es');
    expect(en).toMatch(/3[.,]49/);
    expect(es).toMatch(/3[.,]49/);
  });
});

describe('cart normalize', () => {
  it('merges duplicate product lines', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const items = normalizeCartItems([
      { productId: id, quantity: 2 },
      { productId: id, quantity: 3 },
    ]);
    expect(items).toEqual([{ productId: id, quantity: 5 }]);
  });
});
