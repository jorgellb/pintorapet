import type { AstroCookies, AstroCookieSetOptions } from 'astro';

export type ParsedCookie = { name: string; value: string; options: AstroCookieSetOptions };

/** One `Set-Cookie` header value, in the shape `cookies.set()` takes. */
export function parseSetCookie(header: string): ParsedCookie | null {
  const [pair, ...attributes] = header.split(';').map((part) => part.trim());
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq <= 0) return null;
  const options: AstroCookieSetOptions = {};
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey!.toLowerCase();
    const value = rest.join('=');
    if (key === 'max-age') options.maxAge = Number(value);
    else if (key === 'expires') options.expires = new Date(value);
    else if (key === 'path') options.path = value;
    else if (key === 'domain') options.domain = value;
    else if (key === 'httponly') options.httpOnly = true;
    else if (key === 'secure') options.secure = true;
    else if (key === 'samesite') options.sameSite = value.toLowerCase() as 'lax' | 'strict' | 'none';
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), options };
}

/**
 * Better Auth answers with Set-Cookie headers (session started, refreshed or
 * ended); hand them to Astro so they reach the browser. Values are already
 * encoded, so they are passed through untouched.
 */
export function forwardCookies(headers: Headers | null | undefined, cookies: AstroCookies): void {
  for (const header of headers?.getSetCookie() ?? []) {
    const cookie = parseSetCookie(header);
    if (cookie) cookies.set(cookie.name, cookie.value, { ...cookie.options, encode: (value) => value });
  }
}
