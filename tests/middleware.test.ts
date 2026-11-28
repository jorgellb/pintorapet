import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:middleware', () => ({ defineMiddleware: <T>(fn: T) => fn }));
vi.mock('@/lib/server/account', () => ({ customerSession: async () => null }));

const { onRequest } = await import('../src/middleware');

type Options = { method?: string; status?: number; type?: string; cookie?: string; headers?: Record<string, string> };

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
    cookies: { get: () => undefined, delete: () => {}, headers: function* () {} },
    redirect: (location: string, status: number) => new Response(null, { status, headers: { location } }),
  };
  const next = async () =>
    new Response('<!doctype html><title>x</title>', {
      status: options.status ?? 200,
      headers: { 'Content-Type': options.type ?? 'text/html', ...options.headers },
    });
  const response = (await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)(context, next)) as Response;
  return response.headers;
}

describe('security headers', () => {
  it('ask for HTTPS on every subdomain too, without preload', async () => {
    for (const path of ['/en/', '/admin/', '/api/cart/quote/']) {
      expect((await headersFor(path)).get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    }
  });
});
