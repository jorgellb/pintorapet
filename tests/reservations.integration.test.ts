/**
 * Stock held by checkouts comes back, limits count, old data is forgotten:
 * against a real PostgreSQL built by scripts/aiven/apply-schema.py (each test
 * makes its own rows). Skipped without TEST_DATABASE_URL:
 *   TEST_DATABASE_URL=postgresql://avnadmin:localpw@127.0.0.1:55441/defaultdb npx vitest run tests/reservations.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openOrder, stockOf } from './helpers/pgOrders';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('reservations, limits and retention against PostgreSQL', () => {
  let mod: typeof import('../src/lib/server/db');
  const db = () => mod.db();

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('DATABASE_CA_CERT', '');
    mod = await import('../src/lib/server/db');
  });

  afterAll(async () => {
    await mod.pool().end();
    delete (globalThis as { __pintoraPool?: unknown }).__pintoraPool;
    vi.unstubAllEnvs();
  });

  const release = () => db().one<{ n: number }>`select public.release_lapsed_attempts() as n`;
  const status = (orderId: string) =>
    db().one<{ payment_status: string }>`select payment_status from public.orders where id = ${orderId}`;

  it('a Stripe checkout that never opened gives its piece back after 40 minutes', async () => {
    const fresh = await openOrder(db(), { attemptStatus: 'creating_session', attemptAgo: '10 minutes' });
    const stale = await openOrder(db(), { attemptStatus: 'creating_session', attemptAgo: '50 minutes' });
    await release();
    expect(await stockOf(db(), fresh.productId)).toMatchObject({ stock_reserved: 1 });
    expect(await stockOf(db(), stale.productId)).toMatchObject({ stock_reserved: 0 });
    expect(await status(stale.orderId)).toEqual({ payment_status: 'expired' });
  });

  it('a Stripe session whose expiry webhook never came is released an hour after it ended', async () => {
    const open = await openOrder(db());
    const ended = await openOrder(db(), { sessionExpiresAgo: '2 hours' });
    await release();
    expect(await stockOf(db(), open.productId)).toMatchObject({ stock_reserved: 1 });
    expect(await stockOf(db(), ended.productId)).toMatchObject({ stock_reserved: 0 });
  });

  it('a reviewed payment keeps its pieces however old its checkout is', async () => {
    const f = await openOrder(db(), { sessionExpiresAgo: '2 hours' });
    await db().run`update public.checkout_attempts set status = 'review' where id = ${f.attemptId}`;
    await release();
    expect(await stockOf(db(), f.productId)).toMatchObject({ stock_reserved: 1 });
  });

  it('a cart has one checkout open: a new one releases the older ones', async () => {
    const owner = `owner-${randomUUID()}`;
    const first = await openOrder(db(), { owner });
    const second = await openOrder(db(), { owner });
    const other = await openOrder(db());
    const released = await db().one<{ result: { order_id: string; stripe_session_id: string }[] }>`
      select public.release_owner_open_orders(${second.orderId}) as result`;
    expect(released?.result).toEqual([{ order_id: first.orderId, stripe_session_id: first.sessionId }]);
    expect(await stockOf(db(), first.productId)).toMatchObject({ stock_reserved: 0 });
    expect(await stockOf(db(), second.productId)).toMatchObject({ stock_reserved: 1 });
    expect(await stockOf(db(), other.productId)).toMatchObject({ stock_reserved: 1 });
  });

  it('counts hits per key and window', async () => {
    const key = `ip-${randomUUID()}`;
    const hit = () => db().one<{ ok: boolean }>`select public.rate_limit_hit('test', ${key}, 2, 3600) as ok`;
    expect([await hit(), await hit(), await hit()]).toEqual([{ ok: true }, { ok: true }, { ok: false }]);
    expect(await db().one`select public.rate_limit_hit('test', ${`${key}-b`}, 2, 3600) as ok`).toEqual({ ok: true });
  });

  it('forgets what the privacy page says it keeps only for a while', async () => {
    const oldQuote = randomUUID();
    await db().run`
      insert into public.checkout_quotes (id, cart_owner_hash, locale, lines, price_fingerprint, config_version,
        subtotal_cents, total_cents, expires_at, created_at, invoice_customer)
      values (${oldQuote}, 'o', 'es', '[]', 'fp', 1, 100, 100, now() - interval '40 days', now() - interval '40 days',
        '{"taxId":"12345678Z","name":"Ana"}')`;
    // A quote someone went on to pay stays (its order points at it).
    const paid = await openOrder(db());
    await db().run`update public.checkout_quotes set created_at = now() - interval '40 days' where id = ${paid.quoteId}`;
    const mail = randomUUID();
    await db().run`
      insert into public.notification_outbox (id, dedupe_key, recipient, locale, template_key, payload, status, next_run_at, sent_at)
      values (${mail}, ${`test:${mail}`}, 'ana@example.com', 'es', 'contact_admin', '{"message":"hola"}', 'sent', now(), now() - interval '100 days')`;
    const message = randomUUID();
    await db().run`
      insert into public.contact_messages (id, locale, contact_name, contact_email, message, status, created_at, updated_at)
      values (${message}, 'es', 'Ana', 'ana@example.com', 'hola', 'received', now() - interval '3 years', now() - interval '3 years')`;
    await db().run`
      insert into public.page_views (session_hash, path, viewed_at) values (${`old-${mail}`}, '/es/', now() - interval '14 months')`;

    const counts = await db().one<{ result: Record<string, number> }>`select public.purge_expired_data() as result`;
    expect(counts?.result).toMatchObject({ quotes: expect.any(Number), emails: expect.any(Number) });
    expect(await db().one`select 1 as x from public.checkout_quotes where id = ${oldQuote}`).toBeNull();
    expect(await db().one`select 1 as x from public.checkout_quotes where id = ${paid.quoteId}`).toEqual({ x: 1 });
    expect(await db().one`select payload, recipient from public.notification_outbox where id = ${mail}`).toEqual({ payload: {}, recipient: '' });
    expect(await db().one`select 1 as x from public.contact_messages where id = ${message}`).toBeNull();
    expect(await db().one`select 1 as x from public.page_views where session_hash = ${`old-${mail}`}`).toBeNull();
  });

  it('forgets a commission request only when it is old and nothing points at it', async () => {
    const request = async (age: string) => {
      const id = randomUUID();
      await db().run`
        insert into public.commission_requests (id, reference, locale, contact_name, contact_email, message, status, created_at, updated_at)
        values (${id}, ${`EN-${id.slice(0, 8)}`}, 'es', 'Ana', 'ana@example.com', 'mi perro', 'received',
          now() - ${age}::interval, now() - ${age}::interval)`;
      return id;
    };
    const recent = await request('1 month');
    const old = await request('3 years');
    await expect(db().one`select public.forget_commission(${recent})`).rejects.toThrow(/COMMISSION_NOT_STALE/);
    await db().one`select public.forget_commission(${old})`;
    expect(await db().one`select 1 as x from public.commission_requests where id = ${old}`).toBeNull();
    expect(await db().one`select 1 as x from public.commission_requests where id = ${recent}`).toEqual({ x: 1 });
  });

  it('none of this can be run by a visitor or a customer', async () => {
    const denied = /permission denied/;
    await expect(mod.asAnon((tx) => tx.one`select public.release_lapsed_attempts()`)).rejects.toThrow(denied);
    await expect(mod.asAnon((tx) => tx.one`select public.rate_limit_hit('x', 'y', 1, 60)`)).rejects.toThrow(denied);
    await expect(mod.asAnon((tx) => tx.one`select public.purge_expired_data()`)).rejects.toThrow(denied);
    await expect(mod.asAnon((tx) => tx.one`select * from public.rate_limits`)).rejects.toThrow(denied);
  });
});
