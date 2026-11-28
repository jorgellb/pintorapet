/**
 * Who may keep a copy of a response. Pages and routes that show one person's
 * data are never stored. Public pages render nothing per visitor (the header's
 * account link is the same for everyone, and the cart count and coupon notes are
 * filled in by the browser), so Vercel's CDN may keep their HTML a few seconds.
 */

/** Admin, the API, the cart, checkout, order status and the account area. */
export function isPrivatePath(pathname: string): boolean {
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/') ||
    pathname.includes('/cart') ||
    pathname.includes('/carrito') ||
    pathname.includes('/checkout') ||
    pathname.includes('/finalizar-compra') ||
    pathname.includes('/compra/') ||
    pathname.includes('/order-status') ||
    pathname.includes('/estado-pedido') ||
    pathname.startsWith('/en/account') ||
    pathname.startsWith('/es/cuenta') ||
    // Personal links: a customer's review form, a commission's quote to pay.
    /^\/(en\/review|es\/opinion|en\/commissions\/pay|es\/encargos\/pagar)(\/|$)/.test(pathname)
  );
}

/**
 * The CDN serves a public page from its copy for 10 s, then for up to a minute
 * more while it fetches a fresh one. The browser always asks again.
 */
export const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=10, stale-while-revalidate=60';

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

/**
 * The Cache-Control the middleware sets, or null to leave the response alone.
 * A public page is cached only for a visitor without a session, when it is a
 * 200 HTML answer to a GET that sets no cookie and chose no caching itself.
 */
export function cacheControlFor(input: {
  method: string;
  pathname: string;
  requestCookies: string | null;
  response: Response;
  setsCookies: boolean;
}): string | null {
  const { method, pathname, requestCookies, response, setsCookies } = input;
  if (isPrivatePath(pathname)) return 'private, no-store';
  if (method !== 'GET' || response.status !== 200) return null;
  if (response.headers.has('Cache-Control') || response.headers.has('Set-Cookie') || setsCookies) return null;
  if (!(response.headers.get('Content-Type') ?? '').startsWith('text/html')) return null;
  if (SESSION_COOKIE.test(requestCookies ?? '')) return null;
  return PUBLIC_PAGE_CACHE;
}
