import { describe, expect, it } from 'vitest';
import { netCents, splitGross } from '../src/lib/domain/vat';

describe('netCents', () => {
  it('removes VAT from an inclusive price, rounding half up', () => {
    expect(netCents(1210, 21)).toBe(1000);
    expect(netCents(999, 21)).toBe(826);
    expect(netCents(1100, 10)).toBe(1000);
    expect(netCents(500, 0)).toBe(500);
  });
});

describe('splitGross', () => {
  it('splits an inclusive total into base and quota that add up', () => {
    expect(splitGross(2997, 21)).toEqual({ baseCents: 2477, vatCents: 520 });
    expect(splitGross(690, 21)).toEqual({ baseCents: 570, vatCents: 120 });
    expect(splitGross(1000, 0)).toEqual({ baseCents: 1000, vatCents: 0 });
  });
});
