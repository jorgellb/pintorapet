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
  const apiError = (code: string, statusCode = 400) => ({ statusCode, body: { code, message: code } });
  it('turns Better Auth errors into friendly keys', () => {
    expect(authErrorKey(apiError('INVALID_EMAIL_OR_PASSWORD', 401))).toBe('credentials');
    expect(authErrorKey(apiError('EMAIL_NOT_VERIFIED', 403))).toBe('unconfirmed');
    expect(authErrorKey(apiError('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 422))).toBe('exists');
    expect(authErrorKey(apiError('INVALID_EMAIL'))).toBe('email');
    expect(authErrorKey(apiError('PASSWORD_TOO_SHORT'))).toBe('weak');
    expect(authErrorKey(apiError('ANYTHING', 429))).toBe('rate');
    expect(authErrorKey(new Error('MAIL_FAILED: Resend refused'))).toBe('mail');
    expect(authErrorKey(new Error('Something else'))).toBe('generic');
    expect(authErrorKey(null)).toBe('generic');
  });
});
