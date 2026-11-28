import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePaypalOrder, paypalToken, PaypalApiError } from '../src/lib/server/payments/paypal';

// Each test uses its own client id: paypal.ts caches tokens per client.
const creds = (clientId: string) => ({ mode: 'test' as const, clientId, clientSecret: 'secret' });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const aborted = () => AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError'));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PayPal requests', () => {
  it('give up after 15 s, the token and the API call alike', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/oauth2/token')
        ? json({ access_token: 'token', expires_in: 3600 })
        : json({ id: 'ORDER-1', status: 'COMPLETED' }, 201),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await capturePaypalOrder(creds('timeouts'), 'ORDER-1', 'req-1')).toEqual({ id: 'ORDER-1', status: 'COMPLETED' });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([15_000, 15_000]);
    for (const [, init] of fetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('fail when a capture answer is cut off, instead of returning an empty order', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/oauth2/token')
        ? json({ access_token: 'token', expires_in: 3600 })
        : new Response('{"id": "ORDER-1", "sta', { status: 201 }),
    );
    vi.stubGlobal('fetch', fetch);
    await paypalToken(creds('cut-off'));
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(aborted);
    await expect(capturePaypalOrder(creds('cut-off'), 'ORDER-1', 'req-1')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('keep reporting what PayPal refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error_description: 'Client Authentication failed' }, 401)));
    await expect(paypalToken(creds('refused'))).rejects.toBeInstanceOf(PaypalApiError);
  });
});
