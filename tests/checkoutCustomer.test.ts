import { describe, expect, it } from 'vitest';
import {
  buyerName,
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

describe('a gift', () => {
  it('goes to the name on the parcel; who sends it and the message travel apart', () => {
    const parsed = checkoutCustomerSchema.parse({
      ...customer,
      name: 'Marta López',
      gift: true,
      giftFrom: '  Ana García ',
      giftMessage: ' ¡Feliz Navidad! ',
    });
    expect(parsed.giftFrom).toBe('Ana García');
    expect(parsed.giftMessage).toBe('¡Feliz Navidad!');
    expect(shippingAddressFrom(parsed).name).toBe('Marta López');
    expect(buyerName(parsed)).toBe('Ana García');
  });

  it('is bought by the name on the parcel when it is not a gift, whatever was typed', () => {
    const parsed = checkoutCustomerSchema.parse({ ...customer, gift: false, giftFrom: 'Otra persona' });
    expect(buyerName(parsed)).toBe('Ana García');
  });

  it('keeps the message short enough for the card', () => {
    expect(() => checkoutCustomerSchema.parse({ ...customer, gift: true, giftMessage: 'x'.repeat(301) })).toThrow();
  });
});

describe('a pickup at a market', () => {
  const pickup = { email: 'ana@example.com', name: 'Ana García', phone: '600123456', country: 'ES', pickup: true };

  it('needs no address', () => {
    const parsed = checkoutCustomerSchema.parse(pickup);
    expect(parsed.line1).toBe('');
    expect(shippingAddressFrom(parsed)).toMatchObject({ name: 'Ana García', phone: '600123456', country: 'ES', line1: '' });
  });

  it('still needs one when it is shipped', () => {
    expect(() => checkoutCustomerSchema.parse({ ...pickup, pickup: false })).toThrow();
  });

  it('matches only a pickup quote, and a pickup quote only a pickup', () => {
    const parsed = checkoutCustomerSchema.parse(pickup);
    expect(destinationMatches(parsed, { country: 'ES', postalCode: null, pickupMarketId: 'm1' })).toBe(true);
    expect(destinationMatches(parsed, { country: 'ES', postalCode: '46001' })).toBe(false);
    const shipped = checkoutCustomerSchema.parse(customer);
    expect(destinationMatches(shipped, { country: 'ES', postalCode: '46001', pickupMarketId: 'm1' })).toBe(false);
  });
});
