import { defineMiddleware } from 'astro:middleware';
import { customerSession } from '@/lib/server/account';
import { takeFlash } from '@/lib/server/flash';
import { safeNext } from '@/lib/domain/accountProfile';

const ACCOUNT_AREA = /^\/(en\/account|es\/cuenta)(\/|$)/;
const OPEN_ACCOUNT_PAGES = /^\/(en\/account\/(sign-in|register|forgot-password)|es\/cuenta\/(entrar|registro|recuperar))\/?$/;
const SIGN_IN_PAGES = /^\/(en\/account\/(sign-in|register)|es\/cuenta\/(entrar|registro))\/?$/;
const NEW_PASSWORD = /^\/(en\/account\/new-password|es\/cuenta\/nueva-contrasena)\/?$/;
const CHECKOUT = /^\/(en\/checkout|es\/finalizar-compra)\/?$/;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function withHeaders(
  response: Response,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Sessions are read here, before rendering starts, so refreshed cookies and
  // redirects can still be sent.
  if (context.request.method === 'GET' && (ACCOUNT_AREA.test(pathname) || CHECKOUT.test(pathname))) {
    const locale = pathname.startsWith('/en/') ? 'en' : 'es';
    const accountHome = locale === 'en' ? '/en/account/' : '/es/cuenta/';
    const signIn = locale === 'en' ? '/en/account/sign-in/' : '/es/cuenta/entrar/';
    context.locals.customer = await customerSession(context.cookies, context.request);
    context.locals.flash = takeFlash(context.cookies);

    if (ACCOUNT_AREA.test(pathname)) {
      const signedIn = Boolean(context.locals.customer);
      const next = context.url.searchParams.get('next');
      if (signedIn && SIGN_IN_PAGES.test(pathname)) {
        return context.redirect(safeNext(next, accountHome), 303);
      }
      // The new-password page explains an expired link itself.
      if (!signedIn && !OPEN_ACCOUNT_PAGES.test(pathname) && !NEW_PASSWORD.test(pathname)) {
        return context.redirect(`${signIn}?next=${encodeURIComponent(pathname)}`, 303);
      }
    }
  }

  const response = await next();

  if (
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
    pathname.startsWith('/es/cuenta')
  ) {
    return withHeaders(response, {
      'Cache-Control': 'private, no-store',
    });
  }

  return withHeaders(response);
});
