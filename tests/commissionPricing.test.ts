import { describe, expect, it } from 'vitest';
import { commissionEstimate } from '../src/lib/domain/commissionPricing';

describe('commissionEstimate', () => {
  it('starts at the size price for one subject', () => {
    expect(commissionEstimate('A4', 1)).toBe(9000);
    expect(commissionEstimate('A3', 1)).toBe(11000);
  });

  it('adds €20 per additional subject', () => {
    expect(commissionEstimate('A4', 3)).toBe(13000);
    expect(commissionEstimate('A3', 2)).toBe(13000);
  });

  it('clamps the number of subjects', () => {
    expect(commissionEstimate('A4', 0)).toBe(9000);
    expect(commissionEstimate('A4', 99)).toBe(9000 + 9 * 2000);
    expect(commissionEstimate('A4', Number.NaN)).toBe(9000);
  });

  it('has no estimate while the size is open', () => {
    expect(commissionEstimate('undecided', 2)).toBeNull();
  });
});
