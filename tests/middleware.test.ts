import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_PAGE_CACHE } from '../src/lib/server/cachePolicy';

vi.mock('astro:middleware', () => ({ defineMiddleware: <T>(fn: T) => fn }));
vi.mock('@/lib/server/account', () => ({ customerSession: async () => null }));

const { onRequest } = await import('../src/middleware');

type Options = {
  method?: string;
  status?: number;
  type?: string;
  cookie?: string;
  headers?: Record<string, string>;
  /** A cookie the page set through Astro.cookies. */
  setsCookie?: boolean;
};

async function headersFor(pathname: string, options: Options = {}): Promise<Headers> {
  const url = new URL(`http://localhost${pathname}`);
  const request = new Request(url, {
    method: options.method ?? 'GET',
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  const context = {
    url,
    request,
    locals: {},
    cookies: {
      get: () => undefined,
      delete: () => {},
      headers: function* () {
        if (options.setsCookie) yield 'pd_x=1; Path=/';
      },
    },
    redirect: (location: string, status: number) => new Response(null, { status, headers: { location } }),
  };
  const next = async () =>
    new Response('<!doctype html><title>x</title>', {
      status: options.status ?? 200,
      headers: { 'Content-Type': options.type ?? 'text/html', ...options.headers },
    });
  const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)(context, next);
  return response.headers;
}

const cacheOf = async (pathname: string, options?: Options) => (await headersFor(pathname, options)).get('Cache-Control');

describe('security headers', () => {
  it('ask for HTTPS on every subdomain too, without preload', async () => {
    for (const path of ['/en/', '/admin/', '/api/cart/quote/']) {
      expect((await headersFor(path)).get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    }
  });
});

describe('caching', () => {
  it('lets the CDN keep public pages a few seconds', async () => {
    expect(PUBLIC_PAGE_CACHE).toBe('public, max-age=0, s-maxage=10, stale-while-revalidate=60');
    for (const path of [
      '/en/',
      '/es/',
      '/en/shop/',
      '/es/tienda/taza-pug/',
      '/en/work/rufus/',
      '/es/galeria/',
      '/en/about-me/',
      '/es/mercados/',
      '/en/contact/',
      '/es/encargos/',
      '/en/privacy/',
    ]) {
      expect(await cacheOf(path), path).toBe(PUBLIC_PAGE_CACHE);
    }
  });

  it('never for Admin, the API, the cart, checkout, order status, the account or personal links', async () => {
    for (const path of [
      '/admin/',
      '/admin/login/',
      '/api/cart/quote/',
      '/api/antibot/challenge/',
      '/en/cart/',
      '/es/carrito/',
      '/en/checkout/',
      '/es/finalizar-compra/',
      '/en/checkout/success/',
      '/es/compra/confirmacion/',
      '/en/order-status/',
      '/es/estado-pedido/',
      '/en/account/sign-in/',
      '/en/account/new-password/',
      '/es/cuenta/registro/',
      '/en/account-help/',
      '/en/review/',
      '/es/opinion/',
      '/en/commissions/pay/',
      '/es/encargos/pagar/',
    ]) {
      expect(await cacheOf(path), path).toBe('private, no-store');
    }
  });

  it('only for an anonymous GET answered with 200 HTML', async () => {
    expect(await cacheOf('/en/', { cookie: 'better-auth.session_token=abc' })).toBeNull();
    expect(await cacheOf('/en/', { cookie: 'pd_cart_owner=x; __Secure-better-auth.session_token=abc' })).toBeNull();
    expect(await cacheOf('/en/', { cookie: 'pd_cart_owner=x' })).toBe(PUBLIC_PAGE_CACHE);
    expect(await cacheOf('/en/contact/', { method: 'POST' })).toBeNull();
    expect(await cacheOf('/en/', { method: 'HEAD' })).toBeNull();
    expect(await cacheOf('/en/shop/nope/', { status: 404 })).toBeNull();
    expect(await cacheOf('/en/shop/', { status: 500 })).toBeNull();
    expect(await cacheOf('/en/shop/x/', { status: 302 })).toBeNull();
    expect(await cacheOf('/en/feed.json', { type: 'application/json' })).toBeNull();
  });

  it('never when the page sets a cookie or chose its own caching', async () => {
    expect(await cacheOf('/en/', { setsCookie: true })).toBeNull();
    expect(await cacheOf('/en/', { headers: { 'Set-Cookie': 'a=1' } })).toBeNull();
    expect(await cacheOf('/sitemap.xml', { type: 'application/xml', headers: { 'Cache-Control': 'public, s-maxage=3600' } })).toBe(
      'public, s-maxage=3600',
    );
  });
});
