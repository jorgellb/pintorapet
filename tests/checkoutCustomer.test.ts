import { describe, expect, it } from 'vitest';
import {
  checkoutCustomerSchema,
  destinationMatches,
  invoiceCustomerSchema,
  shippingAddressFrom,
  spanishProvince,
  suggestEmail,
} from '../src/lib/domain/checkoutCustomer';

const customer = {
  email: 'Luna@Example.com ',
  name: '  Ana García ',
  phone: '+34 600 123 456',
  line1: 'Calle Mayor 12',
  line2: '3º B',
  city: 'Valencia',
  state: '',
  postalCode: '46001',
  country: 'es',
  note: '',
};

describe('checkoutCustomerSchema', () => {
  it('trims, lowercases the email and uppercases the country', () => {
    const parsed = checkoutCustomerSchema.parse(customer);
    expect(parsed.email).toBe('luna@example.com');
    expect(parsed.name).toBe('Ana García');
    expect(parsed.country).toBe('ES');
  });

  it('requires a Spanish postal code of five digits', () => {
    expect(() => checkoutCustomerSchema.parse({ ...customer, postalCode: '4600' })).toThrow();
  });

  it('accepts other countries without a strict postal format', () => {
    const parsed = checkoutCustomerSchema.parse({ ...customer, country: 'GB', postalCode: 'SW1A 1AA' });
    expect(parsed.postalCode).toBe('SW1A 1AA');
  });

  it('rejects a phone without enough digits', () => {
    expect(() => checkoutCustomerSchema.parse({ ...customer, phone: '123' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => checkoutCustomerSchema.parse({ ...customer, total: 1 })).toThrow();
  });
});

describe('invoiceCustomerSchema', () => {
  const invoice = {
    taxId: '12345678z',
    name: 'Ana García',
    address: 'Calle Mayor 12',
    postalCode: '46001',
    city: 'Valencia',
    country: 'ES',
  };

  it('accepts a valid Spanish NIF and normalises it', () => {
    expect(invoiceCustomerSchema.parse(invoice).taxId).toBe('12345678Z');
  });

  it('rejects a Spanish NIF with the wrong letter', () => {
    expect(() => invoiceCustomerSchema.parse({ ...invoice, taxId: '12345678A' })).toThrow();
  });

  it('accepts a foreign tax id of 4 to 20 characters', () => {
    const parsed = invoiceCustomerSchema.parse({ ...invoice, country: 'FR', taxId: 'FR 40 303 265 045' });
    expect(parsed.taxId).toBe('FR40303265045');
  });
});

describe('shippingAddressFrom', () => {
  it('uses the shape the orders already store', () => {
    const parsed = checkoutCustomerSchema.parse({ ...customer, note: 'Timbre 3B' });
    expect(shippingAddressFrom(parsed)).toEqual({
      name: 'Ana García',
      line1: 'Calle Mayor 12',
      line2: '3º B',
      city: 'Valencia',
      state: 'Valencia',
      postal_code: '46001',
      country: 'ES',
      phone: '+34 600 123 456',
      note: 'Timbre 3B',
    });
  });
});

describe('destinationMatches', () => {
  const parsed = checkoutCustomerSchema.parse(customer);

  it('matches the quoted country and Spanish postal code', () => {
    expect(destinationMatches(parsed, { country: 'ES', postalCode: '46001' })).toBe(true);
    expect(destinationMatches(parsed, { country: 'ES', postalCode: '35001' })).toBe(false);
    expect(destinationMatches(parsed, { country: 'PT', postalCode: null })).toBe(false);
  });

  it('only compares the country outside Spain', () => {
    const gb = checkoutCustomerSchema.parse({ ...customer, country: 'GB', postalCode: 'SW1A 1AA' });
    expect(destinationMatches(gb, { country: 'GB', postalCode: null })).toBe(true);
  });
});

describe('spanishProvince', () => {
  it('names the province from the postal code', () => {
    expect(spanishProvince('46001')).toBe('Valencia');
    expect(spanishProvince('28013')).toBe('Madrid');
    expect(spanishProvince('35001')).toBe('Las Palmas');
    expect(spanishProvince('07001')).toBe('Illes Balears');
  });

  it('returns null for codes that are not Spanish', () => {
    expect(spanishProvince('99001')).toBeNull();
    expect(spanishProvince('460')).toBeNull();
  });
});

describe('suggestEmail', () => {
  it('suggests the usual domain for common typos', () => {
    expect(suggestEmail('ana@gmial.com')).toBe('ana@gmail.com');
    expect(suggestEmail('ana@hotmal.es')).toBe('ana@hotmail.es');
    expect(suggestEmail('ana@gmail.con')).toBe('ana@gmail.com');
  });

  it('stays quiet for correct or unknown domains', () => {
    expect(suggestEmail('ana@gmail.com')).toBeNull();
    expect(suggestEmail('ana@estudio-meili.es')).toBeNull();
    expect(suggestEmail('not-an-email')).toBeNull();
  });
});

describe('postcodes outside Spain', () => {
  it('is required where the country uses them', () => {
    expect(() =>
      checkoutCustomerSchema.parse({ ...customer, country: 'FR', postalCode: '' }),
    ).toThrow();
  });

  it('is optional where the country has none', () => {
    const parsed = checkoutCustomerSchema.parse({ ...customer, country: 'HK', postalCode: '' });
    expect(parsed.postalCode).toBe('');
  });
});
