import { describe, expect, it } from 'vitest';
import { parseSetCookie } from '../src/lib/server/auth/cookies';

describe('parseSetCookie', () => {
  it('reads name, value and the attributes Astro needs', () => {
    expect(
      parseSetCookie('better-auth.session_token=abc.def%3D; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax'),
    ).toEqual({
      name: 'better-auth.session_token',
      value: 'abc.def%3D',
      options: { maxAge: 604800, path: '/', httpOnly: true, secure: true, sameSite: 'lax' },
    });
  });

  it('reads expiry dates and clears', () => {
    const parsed = parseSetCookie('session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Max-Age=0');
    expect(parsed?.value).toBe('');
    expect(parsed?.options.maxAge).toBe(0);
    expect(parsed?.options.expires?.getTime()).toBe(0);
  });

  it('ignores something that is not a cookie', () => {
    expect(parseSetCookie('')).toBeNull();
    expect(parseSetCookie('=value')).toBeNull();
  });
});
