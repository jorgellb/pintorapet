import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ok: true as boolean | Error, calls: [] as unknown[][] }));

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('../src/lib/server/db')>()),
  serviceDb: () => ({
    one: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.calls.push(values);
      if (state.ok instanceof Error) throw state.ok;
      return { ok: state.ok };
    },
  }),
}));

const { RATE, withinLimit } = await import('../src/lib/server/rateLimit');

const visitor = (ip: string) => ({ request: new Request('http://x/', { headers: { 'x-real-ip': ip } }) });

beforeEach(() => {
  state.ok = true;
  state.calls = [];
});

describe('rate limits', () => {
  it('counts by a hash of the IP, never the IP itself', async () => {
    expect(await withinLimit(RATE.checkout, visitor('203.0.113.9'))).toBe(true);
    const [bucket, key, limit, windowSeconds] = state.calls[0];
    expect([bucket, limit, windowSeconds]).toEqual(['checkout', 10, 3600]);
    expect(key).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(state.calls)).not.toContain('203.0.113.9');
    await withinLimit(RATE.checkout, visitor('203.0.113.9'));
    expect(state.calls[1][1]).toBe(key);
  });

  it('says no once the database says the window is full', async () => {
    state.ok = false;
    expect(await withinLimit(RATE.quote, visitor('203.0.113.9'))).toBe(false);
  });

  it('lets the request through if the count cannot be made', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.ok = new Error('connection refused');
    expect(await withinLimit(RATE.pageView, visitor('203.0.113.9'))).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
