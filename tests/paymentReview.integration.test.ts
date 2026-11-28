/**
 * Payments that do not fit their order, invoices and role privileges, against
 * a real PostgreSQL built by scripts/aiven/apply-schema.py (no data needed:
 * each test makes its own rows). Skipped without TEST_DATABASE_URL:
 *   TEST_DATABASE_URL=postgresql://avnadmin:localpw@127.0.0.1:55441/defaultdb npx vitest run tests/paymentReview.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openOrder as makeOrder, stockOf, type OpenOrder } from './helpers/pgOrders';

const url = process.env.TEST_DATABASE_URL;

type Mod = typeof import('../src/lib/server/db');

describe.skipIf(!url)('payments, invoices and privileges against PostgreSQL', () => {
  let mod: Mod;
  let adminId: string;
  let customerId: string;

  const db = () => mod.db();

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('DATABASE_CA_CERT', '');
    mod = await import('../src/lib/server/db');
    adminId = randomUUID();
    customerId = randomUUID();
    await db().run`insert into auth.users (id, email, email_verified) values
      (${adminId}, ${`admin-${adminId}@example.com`}, true), (${customerId}, ${`c-${customerId}@example.com`}, true)`;
    await db().run`insert into public.admin_users (user_id, email) values (${adminId}, ${`admin-${adminId}@example.com`})`;
  });

  afterAll(async () => {
    await mod.pool().end();
    delete (globalThis as { __pintoraPool?: unknown }).__pintoraPool;
    vi.unstubAllEnvs();
  });

  type Fixture = OpenOrder;
  const openOrder = (opts: Parameters<typeof makeOrder>[1] = {}) => makeOrder(db(), opts);

  type Paid = { status: string; reason?: string; replay?: boolean };

  function pay(
    f: Fixture,
    opts: { amount?: number; postal?: string; eventId?: string; paymentIntent?: string; sessionId?: string } = {},
  ) {
    const address = { line1: 'Calle Mayor 1', city: 'Madrid', country: 'ES', postal_code: opts.postal ?? '28001' };
    return db().one<{ result: Paid }>`
      select public.apply_payment(
        p_order_id => ${f.orderId}, p_stripe_event_id => ${opts.eventId ?? `evt_${randomUUID()}`},
        p_stripe_session_id => ${opts.sessionId ?? f.sessionId}, p_stripe_payment_intent_id => ${opts.paymentIntent ?? `pi_${f.orderId}`},
        p_amount_total_cents => ${opts.amount ?? 1500}, p_currency => 'EUR', p_customer_email => 'ana@example.com',
        p_customer_name => 'Ana', p_shipping_address => ${JSON.stringify(address)}::jsonb) as result`.then((r) => r!.result);
  }

  const order = (id: string) =>
    db().one<{ payment_status: string; review_reason: string | null; paid_at: string | null; stripe_payment_intent_id: string | null; vat_regime: string; shipping_postal_code: string }>`
      select payment_status, review_reason, paid_at, stripe_payment_intent_id, vat_regime, shipping_postal_code
      from public.orders where id = ${id}`;
  const stock = (productId: string) => stockOf(db(), productId);
  const alerts = (orderId: string) =>
    db().rows<{ reason: string; payment?: string }>`
      select payload->>'reason' as reason, payload->>'payment' as payment from public.notification_outbox
      where template_key = 'payment_review_admin' and payload->>'order_id' = ${orderId} order by created_at`
      .then((rows) => rows.map((row) => (row.payment ? row : { reason: row.reason })));

  it('a payment that fits is paid and takes the piece', async () => {
    const f = await openOrder();
    expect(await pay(f)).toMatchObject({ status: 'paid', replay: false });
    expect(await order(f.orderId)).toMatchObject({ payment_status: 'paid', review_reason: null });
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 0, stock_reserved: 0 });
  });

  it('a wrong amount is kept on the order for review, with the piece still held, and Meili is told', async () => {
    const f = await openOrder();
    const eventId = `evt_${randomUUID()}`;
    expect(await pay(f, { amount: 900, eventId })).toMatchObject({ status: 'review', reason: 'AMOUNT_MISMATCH' });
    const row = await order(f.orderId);
    expect(row).toMatchObject({ payment_status: 'review', review_reason: 'AMOUNT_MISMATCH', stripe_payment_intent_id: `pi_${f.orderId}` });
    expect(row?.paid_at).not.toBeNull();
    const event = await db().one`select status, last_error from public.stripe_events where event_id = ${eventId}`;
    expect(event).toEqual({ status: 'processed', last_error: 'AMOUNT_MISMATCH' });
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 1, stock_reserved: 1 });
    expect(await alerts(f.orderId)).toEqual([{ reason: 'AMOUNT_MISMATCH' }]);
    // Stripe retrying the same event changes nothing.
    expect(await pay(f, { amount: 900, eventId })).toMatchObject({ status: 'review', replay: true });
  });

  it('a piece that cannot be taken undoes the whole sale and goes to review', async () => {
    // Its reservation is there, but the stock no longer counts it as held.
    const f = await openOrder({ held: 0 });
    expect(await pay(f)).toMatchObject({ status: 'review', reason: 'STOCK_CONSUME_FAILED' });
    expect(await order(f.orderId)).toMatchObject({ payment_status: 'review', review_reason: 'STOCK_CONSUME_FAILED' });
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
    const sales = await db().one<{ n: number }>`select count(*) as n from public.stock_movements where order_id = ${f.orderId}`;
    expect(sales?.n).toBe(0);
  });

  it('paid after its reservation lapsed: review, and confirming takes the piece from free stock', async () => {
    const f = await openOrder({ reserve: false });
    expect(await pay(f)).toMatchObject({ status: 'review', reason: 'PAID_WITHOUT_RESERVATION' });
    await mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'confirm' }));
    expect(await order(f.orderId)).toMatchObject({ payment_status: 'paid', review_reason: null });
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 0, stock_reserved: 0 });
  });

  it('quoted to Canarias, delivered in Madrid: held, not sold or invoiced; confirming applies Spanish VAT', async () => {
    const f = await openOrder({ postal: '35001' });
    expect((await order(f.orderId))?.vat_regime).toBe('no_vat');
    expect(await pay(f, { postal: '28013' })).toMatchObject({ status: 'review', reason: 'DESTINATION_CHANGED' });
    // The piece stays reserved for this customer until Meili decides.
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 1, stock_reserved: 1 });
    await mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'confirm' }));
    expect(await order(f.orderId)).toMatchObject({ payment_status: 'paid', vat_regime: 'es_vat', shipping_postal_code: '28013' });
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 0, stock_reserved: 0 });
  });

  it('cancelling a payment delivered elsewhere puts its piece back on sale', async () => {
    const f = await openOrder({ postal: '28001' });
    await pay(f, { postal: '35001' });
    await mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'cancel' }));
    expect(await order(f.orderId)).toMatchObject({ payment_status: 'cancelled' });
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
  });

  it('a payment whose stock could not be taken can still be confirmed or cancelled', async () => {
    const confirmed = await openOrder({ held: 0 });
    await pay(confirmed);
    await mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: confirmed.orderId, p_action: 'confirm' }));
    expect(await order(confirmed.orderId)).toMatchObject({ payment_status: 'paid' });
    expect(await stock(confirmed.productId)).toEqual({ stock_on_hand: 0, stock_reserved: 0 });

    const cancelled = await openOrder({ held: 0 });
    await pay(cancelled);
    await mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: cancelled.orderId, p_action: 'cancel' }));
    expect(await order(cancelled.orderId)).toMatchObject({ payment_status: 'cancelled' });
    expect(await stock(cancelled.productId)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
  });

  it('an order delivered outside its quoted region is never invoiced', async () => {
    const f = await openOrder({ postal: '35001' });
    await pay(f, { postal: '28013' });
    await expect(db().one`select public.issue_invoice(${f.orderId})`).rejects.toThrow(/INVOICE_ORDER_NOT_PAID|INVOICE_DESTINATION_MISMATCH/);
    // Even marked paid by hand, the invoice waits.
    await db().run`update public.orders set payment_status = 'paid' where id = ${f.orderId}`;
    await db().run`
      insert into public.shop_settings (id, invoice_config) values (1, '{"issuerName":"Test","issuerNif":"12345678Z","issuerAddress":"C/ Uno 1","issuerPostalCode":"28001","issuerCity":"Madrid"}')
      on conflict (id) do update set invoice_config = excluded.invoice_config`;
    await expect(db().one`select public.issue_invoice(${f.orderId})`).rejects.toThrow(/INVOICE_DESTINATION_MISMATCH/);
  });

  it('cancelling a reviewed payment puts its piece back on sale and keeps the payment on record', async () => {
    const f = await openOrder();
    await pay(f, { amount: 900 });
    await mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'cancel' }));
    const row = await order(f.orderId);
    expect(row).toMatchObject({ payment_status: 'cancelled', stripe_payment_intent_id: `pi_${f.orderId}` });
    expect(row?.paid_at).not.toBeNull();
    expect(await stock(f.productId)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
  });

  it('a wrong amount cannot be confirmed, and only an admin settles a review', async () => {
    const f = await openOrder();
    await pay(f, { amount: 900 });
    await expect(
      mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'confirm' })),
    ).rejects.toThrow(/REVIEW_NOT_CONFIRMABLE/);
    await expect(
      mod.asUser(customerId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'cancel' })),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('a second, different payment for a paid order is recorded and reported, not taken for a retry', async () => {
    const f = await openOrder();
    await pay(f);
    // Paid in a second tab: another session, another payment.
    const again = { paymentIntent: `pi_other_${f.orderId}`, sessionId: `cs_other_${f.orderId}` };
    expect(await pay(f, again)).toMatchObject({ status: 'paid', reason: 'PAID_AGAIN' });
    expect(await alerts(f.orderId)).toEqual([{ reason: 'PAID_AGAIN', payment: again.paymentIntent }]);
    // A third one is reported on its own.
    await pay(f, { paymentIntent: `pi_third_${f.orderId}`, sessionId: `cs_third_${f.orderId}` });
    expect(await alerts(f.orderId)).toHaveLength(2);
    // The same payment under another event (async success after completed) is a replay.
    expect(await pay(f)).toMatchObject({ status: 'paid', replay: true });
  });

  it('paid after it was cancelled: review, with the payment kept; a wrong amount is still a wrong amount', async () => {
    const f = await openOrder();
    await db().one`select public.release_reservations(${f.attemptId}, 'cancelled')`;
    expect(await pay(f)).toMatchObject({ status: 'review', reason: 'PAID_AFTER_CANCEL' });

    const short = await openOrder();
    await db().one`select public.release_reservations(${short.attemptId}, 'cancelled')`;
    expect(await pay(short, { amount: 900 })).toMatchObject({ status: 'review', reason: 'AMOUNT_MISMATCH' });
    await expect(
      mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: short.orderId, p_action: 'confirm' })),
    ).rejects.toThrow(/REVIEW_NOT_CONFIRMABLE/);
  });

  it('a review with no known reason can only be cancelled', async () => {
    const f = await openOrder();
    await db().run`update public.orders set payment_status = 'review', paid_at = now() where id = ${f.orderId}`;
    await expect(
      mod.asUser(adminId, (tx) => tx.call('admin_resolve_payment_review', { p_order_id: f.orderId, p_action: 'confirm' })),
    ).rejects.toThrow(/REVIEW_NOT_CONFIRMABLE/);
  });

  it('a paid order delivered elsewhere that skipped review is invoiced with the delivery address', async () => {
    const f = await openOrder({ postal: '35001' });
    const address = JSON.stringify({ line1: 'Calle Mayor 1', city: 'Madrid', country: 'ES', postal_code: '28013' });
    await db().run`update public.orders set shipping_address = ${address}::jsonb where id = ${f.orderId}`;
    await db().run`update public.orders set payment_status = 'paid', paid_at = now() where id = ${f.orderId}`;
    await db().run`
      insert into public.shop_settings (id, invoice_config) values (1, '{"issuerName":"Test","issuerNif":"12345678Z","issuerAddress":"C/ Uno 1","issuerPostalCode":"28001","issuerCity":"Madrid"}')
      on conflict (id) do update set invoice_config = excluded.invoice_config`;
    const result = await mod.asUser(adminId, (tx) =>
      tx.call<{ invoice_id: string | null }>('admin_accept_destination', { p_order_id: f.orderId }),
    );
    expect(await order(f.orderId)).toMatchObject({ vat_regime: 'es_vat', shipping_postal_code: '28013' });
    const invoice = await db().one<{ vat_regime: string; vat_cents: number }>`
      select vat_regime, vat_cents from public.invoices where id = ${result.invoice_id}`;
    expect(invoice).toEqual({ vat_regime: 'es_vat', vat_cents: expect.any(Number) });
    expect(invoice!.vat_cents).toBeGreaterThan(0);
  });

  it('"delete abandoned" keeps an old open order that has a payment event', async () => {
    const f = await openOrder();
    await db().run`update public.orders set created_at = now() - interval '3 days' where id = ${f.orderId}`;
    await db().run`
      insert into public.stripe_events (event_id, event_type, related_object_id, status, payload_summary)
      values (${`evt_${randomUUID()}`}, 'checkout.session.completed', ${f.sessionId}, 'failed', ${JSON.stringify({ order_id: f.orderId })}::jsonb)`;
    await mod.asUser(adminId, (tx) => tx.call('admin_delete_abandoned_orders'));
    expect(await order(f.orderId)).not.toBeNull();
  });

  describe('privileges', () => {
    it('a visitor cannot take payments, empty tables or write through the catalogue', async () => {
      const f = await openOrder();
      await expect(
        mod.asAnon((tx) => tx.one`select public.apply_payment(${f.orderId}, 'evt_x', null, null, 1500)`),
      ).rejects.toThrow(/permission denied/);
      await expect(mod.asAnon((tx) => tx.run`truncate public.customers`)).rejects.toThrow(/permission denied/);
      await expect(mod.asAnon((tx) => tx.run`update public.catalog_categories_v set name_es = 'x'`)).rejects.toThrow(/permission denied/);
      await expect(mod.asUser(customerId, (tx) => tx.run`truncate public.shipping_rates`)).rejects.toThrow(/permission denied/);
      await expect(mod.asUser(customerId, (tx) => tx.one`select * from public.claim_outbox(10, 60, 'x')`)).rejects.toThrow(/permission denied/);
    });

    it('a visitor still reads the catalogue and the policies still work', async () => {
      const n = await mod.asAnon((tx) => tx.one<{ n: number }>`select count(*) as n from public.catalog_products_v`);
      expect(n?.n).toEqual(expect.any(Number));
      expect(await mod.asAnon((tx) => tx.one`select count(*) as n from public.markets`)).toEqual({ n: expect.any(Number) });
      expect(await mod.asUser(adminId, (tx) => tx.one`select public.is_admin() as ok`)).toEqual({ ok: true });
    });

    it('stock is set by the admin who is signed in, not by an id the caller sends', async () => {
      const f = await openOrder();
      const set = (who: string, as: string) =>
        mod.asUser(who, (tx) => tx.one`
          select * from public.adjust_inventory(${f.productId}, 5, 'tracked'::public.inventory_mode, ${as}, null)`);
      await expect(set(customerId, adminId)).rejects.toThrow(/NOT_ADMIN/);
      await expect(set(adminId, adminId)).resolves.toMatchObject({ stock_on_hand: 5 });
    });

    it('no role but the owner can truncate, reference, trigger or maintain; visitors never write', async () => {
      const wrong = await db().rows`
        select c.relname, a.privilege_type, a.grantee::regrole::text as who
        from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
          and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
          and (a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
               or (a.grantee <> 'authenticated'::regrole and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
               or (c.relkind <> 'r' and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')))`;
      expect(wrong).toEqual([]);
    });

    it('definer functions a visitor or customer may run are the expected ones', async () => {
      const open = await db().rows<{ name: string; anon: boolean }>`
        select p.proname as name, has_function_privilege('anon', p.oid, 'EXECUTE') as anon
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')`;
      const forVisitors = open.filter((f) => f.anon).map((f) => f.name);
      expect(forVisitors.sort()).toEqual(['is_admin', 'lookup_guest_order']);
      const forCustomers = open.filter((f) => !f.anon).map((f) => f.name);
      const allowed = /^(admin_|customer_)|^(adjust_inventory|request_full_invoice)$/;
      expect(forCustomers.filter((name) => !allowed.test(name))).toEqual([]);
      // The service-only functions behind them are not among them.
      for (const name of ['apply_payment', 'reserve_checkout', 'attach_stripe_session', 'set_order_access_token', 'claim_outbox', 'release_reservations']) {
        expect(forCustomers).not.toContain(name);
      }
    });
  });
});
