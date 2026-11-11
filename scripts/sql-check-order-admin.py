#!/usr/bin/env python3
# Managing orders (Admin › Pedidos): cancel an unpaid order, delete one that was
# never paid, archive, and the new shipping states. One transaction, rolled back.
# Usage: python3 scripts/sql-check-order-admin.py [migration.sql ...]
import json, sys, uuid, psycopg

e = {}
for line in open('.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        e[k] = v.strip().strip('"').strip("'")
conn = psycopg.connect(host=e['SUPABASE_DB_POOLER'], port=5432, user=e['SUPABASE_DB_POOLER_USER'],
                       password=e['SUPABASE_DB_PASSWORD'], dbname='postgres', sslmode='require')
cur = conn.cursor()
ok = bad = 0

def check(name, got, want):
    global ok, bad
    if got == want:
        ok += 1; print('OK  ', name)
    else:
        bad += 1; print('FAIL', name, 'got', got, 'want', want)

# Only these roles, as fixed statements.
SET_ROLE = {'authenticated': 'set local role authenticated'}

def as_role(role, uid=None):
    cur.execute("reset role")
    if role == 'postgres':
        return
    cur.execute(SET_ROLE[role])
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': role}),))

def denied(name, sql, args=(), contains=None):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        check(name, 'allowed', 'denied')
    except Exception as err:
        if contains and contains not in str(err):
            check(name, str(err).splitlines()[0], contains)
        else:
            check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

def one(sql, args=()):
    cur.execute(sql, args)
    return cur.fetchone()

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.orders@example.com',now(),'authenticated','authenticated'),(%s,'ana.orders@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.orders@example.com')", (adm,))
    mug, = one("select p.id from products p join categories c on c.id = p.category_id where c.code = 'mugs' and p.parent_id is null order by p.sku limit 1")
    cur.execute("update inventory set inventory_mode = 'tracked', stock_on_hand = 10, stock_reserved = 0, verified_at = now() where product_id = %s", (mug,))

    def order(ref, status='checkout_open', age='0 hours', provider='stripe', reserve=True):
        oid, = one("""insert into orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash, payment_status,
                                          customer_email, payment_provider, created_at)
                      values (%s, 'es', 999, 0, 999, 'test-orders', %s, 'cliente@example.com', %s, now() - %s::interval) returning id""",
                   (ref, status, provider, age))
        cur.execute("""insert into order_items (order_id, product_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents)
                       values (%s, %s, 'Taza', 'MUG-T', 999, 1, 999)""", (oid, mug))
        quote, = one("""insert into checkout_quotes (cart_owner_hash, locale, lines, price_fingerprint, config_version, subtotal_cents,
                                                    total_cents, expires_at, shipping_country)
                        values ('owner', 'es', '[]', 'fp', 1, 999, 999, now() + interval '1 hour', 'ES') returning id""")
        attempt = str(uuid.uuid4())
        cur.execute("""insert into checkout_attempts (id, order_id, cart_owner_hash, quote_id, request_hash, stripe_idempotency_key, status, payment_provider)
                       values (%s, %s, 'owner', %s, %s, %s, %s, %s)""",
                    (attempt, oid, quote, 'h' + attempt, 'k' + attempt,
                     'session_open' if status == 'checkout_open' else 'expired', provider))
        if reserve:
            res, = one("""insert into stock_reservations (checkout_attempt_id, product_id, quantity, status, expires_at)
                          values (%s, %s, 1, %s, now() + interval '1 hour') returning id""",
                       (attempt, mug, 'active' if status == 'checkout_open' else 'released'))
            if status == 'checkout_open':
                cur.execute("update inventory set stock_reserved = stock_reserved + 1 where product_id = %s", (mug,))
            cur.execute("""insert into stock_movements (product_id, quantity_delta, reason, order_id, reservation_id, dedupe_key)
                           values (%s, -1, 'reservation', %s, %s, %s)""", (mug, oid, res, 'res:' + attempt))
        return oid

    open_order = order('PD-ADM-OPEN')
    still_open = order('PD-ADM-OPEN2')
    paid = order('PD-ADM-PAID', status='paid')
    reserved_before, = one("select stock_reserved from inventory where product_id = %s", (mug,))

    # ——— Customers can do none of this ———
    as_role('authenticated', ana)
    denied('a customer cannot cancel an order', "select public.admin_cancel_order(%s)", (open_order,))
    denied('a customer cannot delete an order', "select public.admin_delete_order(%s)", (open_order,))
    denied('a customer cannot archive an order', "select public.admin_set_order_archived(%s, true)", (paid,))

    # ——— Cancel ———
    as_role('authenticated', adm)
    cur.execute("select public.admin_cancel_order(%s)", (open_order,))
    check('an unpaid order is cancelled', one("select payment_status::text from orders where id = %s", (open_order,))[0], 'cancelled')
    check('its reserved stock is freed', one("select stock_reserved from inventory where product_id = %s", (mug,))[0], reserved_before - 1)
    check('and its payment attempt closed (PayPal will not capture it)', one("select status::text from checkout_attempts where order_id = %s", (open_order,))[0], 'cancelled')
    denied('a paid order cannot be cancelled this way', "select public.admin_cancel_order(%s)", (paid,), contains='ORDER_NOT_CANCELLABLE')

    # ——— Delete ———
    denied('a paid order cannot be deleted', "select public.admin_delete_order(%s)", (paid,), contains='ORDER_NOT_DELETABLE')
    cur.execute("select public.admin_delete_order(%s)", (open_order,))
    check('a cancelled order is deleted', one("select count(*) from orders where id = %s", (open_order,))[0], 0)
    check('with its lines, attempts and stock records', one("""select (select count(*) from order_items where order_id = %s)
                                                                + (select count(*) from checkout_attempts where order_id = %s)
                                                                + (select count(*) from stock_movements where order_id = %s)""",
                                                             (open_order, open_order, open_order))[0], 0)
    as_role('postgres')
    sold = order('PD-ADM-SOLD', status='expired')
    cur.execute("""insert into stock_movements (product_id, quantity_delta, reason, order_id, dedupe_key)
                   values (%s, -1, 'sale', %s, 'sale:test-adm')""", (mug, sold))
    as_role('authenticated', adm)
    denied('an order that moved stock for real is kept', "select public.admin_delete_order(%s)", (sold,), contains='ORDER_NOT_DELETABLE')
    denied('an order still being paid must be cancelled first', "select public.admin_delete_order(%s)", (still_open,), contains='ORDER_NOT_DELETABLE')

    # ——— Abandoned orders, in bulk ———
    as_role('postgres')
    cur.execute("delete from stock_movements where dedupe_key = 'sale:test-adm'")
    cur.execute("delete from order_items where order_id = %s", (sold,))
    old_expired = order('PD-ADM-OLD1', status='expired', age='3 days')
    old_open = order('PD-ADM-OLD2', status='checkout_open', age='3 days')
    new_expired = order('PD-ADM-NEW1', status='expired', age='1 hour')
    new_open = order('PD-ADM-NEW2', status='checkout_open', age='1 hour')
    as_role('authenticated', adm)
    gone = one("select public.admin_delete_abandoned_orders()")[0]
    left = [r[0] for r in cur.execute("select reference from orders where id = any(%s)", ([old_expired, old_open, new_expired, new_open],)).fetchall()]
    check('abandoned orders older than a day go, open ones after two', sorted(left), ['PD-ADM-NEW1', 'PD-ADM-NEW2'])
    check('it says how many', gone >= 2, True)
    check('paid orders stay', one("select count(*) from orders where id = %s", (paid,))[0], 1)

    # ——— Archive ———
    cur.execute("select public.admin_set_order_archived(%s, true)", (paid,))
    check('a paid order is archived', one("select archived_at is not null from orders where id = %s", (paid,))[0], True)
    cur.execute("select public.admin_set_order_archived(%s, false)", (paid,))
    check('and back', one("select archived_at is null from orders where id = %s", (paid,))[0], True)

    # ——— Shipping states ———
    cur.execute("update orders set fulfillment_status = 'in_transit' where id = %s returning fulfillment_status::text", (paid,))
    check('the admin sets "En tránsito"', cur.fetchone()[0], 'in_transit')
    cur.execute("update orders set tracking_events = '[{\"at\":\"2026-11-11T10:00:00Z\",\"text\":\"En reparto\"}]'::jsonb, tracking_checked_at = now() where id = %s", (paid,))
    check('and the order keeps the carrier’s events', one("select jsonb_array_length(tracking_events) from orders where id = %s", (paid,))[0], 1)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
