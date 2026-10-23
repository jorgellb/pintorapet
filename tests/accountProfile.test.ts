import { describe, expect, it } from 'vitest';
import { accountProfileSchema, passwordSchema, safeNext } from '../src/lib/domain/accountProfile';

const profile = {
  full_name: ' Ana García ',
  phone: '',
  address: {
    line1: 'Calle Mayor 12',
    line2: '',
    city: 'Valencia',
    state: '',
    postal_code: '46001',
    country: 'es',
  },
  billing: null,
};

describe('accountProfileSchema', () => {
  it('accepts a profile with an address and no billing data', () => {
    const parsed = accountProfileSchema.parse(profile);
    expect(parsed.full_name).toBe('Ana García');
    expect(parsed.address?.country).toBe('ES');
  });

  it('allows the profile without an address', () => {
    expect(accountProfileSchema.parse({ ...profile, address: null }).address).toBeNull();
  });

  it('rejects a Spanish address without a valid postcode', () => {
    expect(() =>
      accountProfileSchema.parse({ ...profile, address: { ...profile.address, postal_code: '460' } }),
    ).toThrow();
  });

  it('validates the billing tax id', () => {
    const billing = {
      taxId: '12345678A',
      name: 'Ana García',
      address: 'Calle Mayor 12',
      postalCode: '46001',
      city: 'Valencia',
      country: 'ES',
    };
    expect(() => accountProfileSchema.parse({ ...profile, billing })).toThrow();
    expect(accountProfileSchema.parse({ ...profile, billing: { ...billing, taxId: '12345678Z' } }).billing?.taxId).toBe(
      '12345678Z',
    );
  });
});

describe('passwordSchema', () => {
  it('needs at least 8 characters', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('long enough').success).toBe(true);
  });
});

describe('safeNext', () => {
  it('only follows paths on this site', () => {
    expect(safeNext('/es/finalizar-compra/', '/es/cuenta/')).toBe('/es/finalizar-compra/');
    expect(safeNext('https://evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('//evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext(null, '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/\t/evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/\n/evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/\\evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/es/cuenta/pedidos/PD-1/?a=1#x', '/es/cuenta/')).toBe('/es/cuenta/pedidos/PD-1/?a=1#x');
    expect(safeNext('/.//evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/a/..//evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/%2e//evil.example/', '/es/cuenta/')).toBe('/es/cuenta/');
    expect(safeNext('/es/cuenta/?next=//x', '/es/cuenta/')).toBe('/es/cuenta/?next=//x');
  });
});

describe('authErrorKey', async () => {
  const { authErrorKey } = await import('../src/lib/server/account');
  it('turns Supabase messages into friendly keys', () => {
    expect(authErrorKey('Invalid login credentials')).toBe('credentials');
    expect(authErrorKey('Email not confirmed')).toBe('unconfirmed');
    expect(authErrorKey('User already registered')).toBe('exists');
    expect(authErrorKey('Email address "a@b.c" is invalid')).toBe('email');
    expect(authErrorKey('Error sending confirmation email')).toBe('mail');
    expect(authErrorKey('For security purposes, you can only request this after 30 seconds.')).toBe('rate');
    expect(authErrorKey('Something else')).toBe('generic');
  });
});
