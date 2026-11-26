#!/usr/bin/env python3
# Markets and stall sales (Admin › Mercados): who sees the calendar, and a sale
# at the stall (paid, handed over, stock out at once, ticket issued). One
# transaction, always rolled back. Runs on the local Docker PostgreSQL.
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-markets.py
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'aiven'))
from conn import connect  # noqa: E402

conn = connect(sys.argv[1] if len(sys.argv) > 1 else 'local')
cur = conn.cursor()
ok = bad = 0

def check(name, got, want):
    global ok, bad
    if got == want:
        ok += 1; print('OK  ', name)
    else:
        bad += 1; print('FAIL', name, 'got', got, 'want', want)

# Only these roles, as fixed statements.
SET_ROLE = {'authenticated': 'set local role authenticated', 'anon': 'set local role anon'}

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

CONFIG = json.dumps({
    'issuerName': 'MEILI STRINGFELLOW PRUEBA', 'issuerNif': '89890001K', 'issuerAddress': 'Calle Mayor 1',
    'issuerPostalCode': '28013', 'issuerCity': 'Madrid', 'issuerKind': 'autonomo',
    'simplifiedPrefix': 'T', 'fullPrefix': 'U', 'rectifyingPrefix': 'V', 'shippingVatRate': 21, 'verifactuEnabled': False,
})

try:
    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Boss','boss.market@example.com',true,now()),(%s,'Ana','ana.market@example.com',true,now())", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.market@example.com')", (adm,))
    cur.execute("insert into shop_settings (id) values (1) on conflict (id) do nothing")
    cur.execute("update shop_settings set invoice_config = %s::jsonb where id = 1", (CONFIG,))
    cat, = one("select id from categories order by sort_order limit 1")
    mug, = one("""insert into products (sku, category_id, motif, status, price_cents, editorial_order, sale_enabled, weight_grams)
                  values ('T-MKT', %s, 'Pug', 'published', 999, 99002, true, 380) returning id""", (cat,))
    cur.execute("insert into product_translations (product_id, locale, slug, title) values (%s,'es','taza-mkt','Taza Pug'),(%s,'en','mug-mkt','Pug Mug')", (mug, mug))
    cur.execute("insert into inventory (product_id, inventory_mode, stock_on_hand, verified_at) values (%s,'tracked',3,now()) on conflict (product_id) do update set inventory_mode='tracked', stock_on_hand=3, stock_reserved=0, verified_at=now()", (mug,))
    stock = lambda: one("select stock_on_hand, stock_reserved from inventory where product_id = %s", (mug,))

    m1, = one("insert into markets (name, city, starts_on, ends_on, published) values ('Mercado de Navidad', 'Valencia', current_date + 5, current_date + 7, true) returning id")
    m2, = one("insert into markets (name, starts_on, ends_on, published) values ('Borrador', current_date + 30, current_date + 30, false) returning id")
    denied('a market ends after it starts', "insert into markets (name, starts_on, ends_on) values ('Mal', current_date, current_date - 1)")

    as_role('anon')
    check('visitors see published markets only', one("select count(*) from markets where id in (%s, %s)", (m1, m2))[0], 1)
    denied('nor can they add one', "insert into markets (name, starts_on, ends_on) values ('X', current_date, current_date)")
    as_role('authenticated', ana)
    denied('a customer cannot sell at the stall', "select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 1}], 'method': 'cash'}),))

    as_role('authenticated', adm)
    check('the admin sees every market', one("select count(*) from markets where id in (%s, %s)", (m1, m2))[0], 2)
    sale = one("select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 2}], 'method': 'cash', 'market_id': str(m1)}),))[0]
    o = one("""select payment_status::text, fulfillment_status::text, payment_provider, shipping_cents, total_cents, market_id = %s, customer_name, shipping_address is null
                from orders where id = %s""", (m1, sale['order_id']))
    check('a stall sale is paid, handed over, at the market', o, ('paid', 'completed', 'cash', 0, 1998, True, 'Venta en mercado', True))
    check('its pieces leave the stock at once', stock(), (1, 0))
    check('as a sale in the stock ledger', one("select note, sum(quantity_delta) from stock_movements where order_id = %s group by note", (sale['order_id'],)), ('Venta en mercado', -2))
    check('the ticket is issued', one("select kind from invoices where order_id = %s", (sale['order_id'],))[0], 'simplified')
    denied('no more pieces than are free', "select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 2}], 'method': 'terminal'}),), contains='INSUFFICIENT_STOCK')
    denied('cash, terminal or Bizum only', "select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 1}], 'method': 'stripe'}),), contains='MARKET_SALE_METHOD')
    denied('an unknown market', "select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 1}], 'method': 'cash', 'market_id': '00000000-0000-4000-8000-000000000000'}),), contains='MARKET_NOT_FOUND')
    t = one("select public.admin_market_sale(%s::jsonb)", (json.dumps({'lines': [{'product_id': str(mug), 'quantity': 1}], 'method': 'terminal', 'customer': {'name': 'Lucía', 'email': 'ana.market@example.com'}}),))[0]
    check('by card terminal, with a name and email', one("select payment_provider, customer_name, customer_id is not null, market_id is null from orders where id = %s", (t['order_id'],)), ('terminal', 'Lucía', True, True))
    check('and the customer is emailed', one("select count(*) from notification_outbox where payload->>'order_id' = %s", (t['order_id'],))[0], 1)
    item, = one("select id from order_items where order_id = %s", (sale['order_id'],))
    r = one("select public.admin_begin_refund(%s, %s::jsonb, false, true, 'Devuelto en el puesto', true)", (sale['order_id'], json.dumps([{'order_item_id': str(item), 'quantity': 1}])))[0]
    check('a refund at the stall is registered by hand', (r['status'], one("select provider from order_refunds where order_id = %s", (sale['order_id'],))[0]), ('succeeded', 'cash'))
    cur.execute("delete from markets where id = %s", (m1,))
    check('deleting a market keeps its sales', one("select count(*), bool_and(market_id is null) from orders where id = %s", (sale['order_id'],)), (1, True))
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
