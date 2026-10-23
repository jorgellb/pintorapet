import { describe, expect, it } from 'vitest';
import { isValidSpanishTaxId, normalizeTaxId } from '../src/lib/domain/taxId';

describe('normalizeTaxId', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeTaxId(' 12.345.678-z ')).toBe('12345678Z');
    expect(normalizeTaxId('es b-12345674')).toBe('ESB12345674');
  });
});

describe('isValidSpanishTaxId', () => {
  it('accepts DNI with the right letter', () => {
    expect(isValidSpanishTaxId('12345678Z')).toBe(true);
    expect(isValidSpanishTaxId('00000000T')).toBe(true);
    expect(isValidSpanishTaxId('12345678a')).toBe(false);
  });

  it('accepts NIE', () => {
    expect(isValidSpanishTaxId('X1234567L')).toBe(true);
    expect(isValidSpanishTaxId('Y1234567X')).toBe(true);
    expect(isValidSpanishTaxId('X1234567A')).toBe(false);
  });

  it('accepts CIF with numeric or letter control', () => {
    expect(isValidSpanishTaxId('B12345674')).toBe(true);
    expect(isValidSpanishTaxId('A28015865')).toBe(true);
    expect(isValidSpanishTaxId('Q2826000H')).toBe(true);
    expect(isValidSpanishTaxId('B12345675')).toBe(false);
  });

  it('accepts the AEAT test NIF and an ES prefix', () => {
    expect(isValidSpanishTaxId('89890001K')).toBe(true);
    expect(isValidSpanishTaxId('ESB12345674')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isValidSpanishTaxId('')).toBe(false);
    expect(isValidSpanishTaxId('1234')).toBe(false);
    expect(isValidSpanishTaxId('ZZZZZZZZZ')).toBe(false);
  });
});
