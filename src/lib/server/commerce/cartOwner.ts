import { createHash, randomUUID } from 'node:crypto';
import type { AstroCookies } from 'astro';

export const CART_OWNER_COOKIE = 'pd_cart_owner';

export function hashCartOwnerToken(token: string): string {
  return createHash('sha256').update(`petsdrawings:cart:${token}`).digest('hex');
}

/** Ensure a stable opaque cart-owner cookie; return its server-side hash. */
export function ensureCartOwnerHash(cookies: AstroCookies): {
  token: string;
  hash: string;
} {
  const existing = cookies.get(CART_OWNER_COOKIE)?.value;
  const token =
    existing && existing.length >= 16 ? existing : randomUUID().replace(/-/g, '');

  if (token !== existing) {
    cookies.set(CART_OWNER_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      maxAge: 60 * 60 * 24 * 400,
    });
  }

  return { token, hash: hashCartOwnerToken(token) };
}
