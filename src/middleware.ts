import { defineMiddleware } from 'astro:middleware';

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
    pathname.includes('/estado-pedido')
  ) {
    return withHeaders(response, {
      'Cache-Control': 'private, no-store',
    });
  }

  return withHeaders(response);
});
