#!/usr/bin/env python3
# Picking a web order up at a market (checkout): the quote (no shipping,
# Spanish VAT, only at markets that allow it and have not ended) and the
# order it becomes. One transaction, always rolled back.
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-pickup.py
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
    cur.execute("insert into shop_settings (id) values (1) on conflict (id) do nothing")
    cur.execute("update shop_settings set sales_enabled = true, payments_enabled = true where id = 1")
    cat, = one("select id from categories order by sort_order limit 1")
    mug, = one("""insert into products (sku, category_id, motif, status, price_cents, editorial_order, sale_enabled, weight_grams)
                  values ('T-PICK', %s, 'Pug', 'published', 999, 99003, true, 380) returning id""", (cat,))
    cur.execute("insert into product_translations (product_id, locale, slug, title) values (%s,'es','taza-pick','Taza Pug'),(%s,'en','mug-pick','Pug Mug')", (mug, mug))
    cur.execute("insert into inventory (product_id, inventory_mode, stock_on_hand, verified_at) values (%s,'tracked',5,now()) on conflict (product_id) do update set inventory_mode='tracked', stock_on_hand=5, stock_reserved=0, verified_at=now()", (mug,))
    ok_m, = one("insert into markets (name, city, starts_on, ends_on, pickup) values ('Mercado de Ruzafa', 'Valencia', current_date + 3, current_date + 5, true) returning id")
    no_pickup, = one("insert into markets (name, starts_on, ends_on, pickup) values ('Sin recogida', current_date + 3, current_date + 3, false) returning id")
    ended, = one("insert into markets (name, starts_on, ends_on, pickup) values ('Pasado', current_date - 5, current_date - 4, true) returning id")
    draft, = one("insert into markets (name, starts_on, ends_on, pickup, published) values ('Borrador', current_date + 9, current_date + 9, true, false) returning id")
    lines = "array[row(%s::uuid, 2)::public.cart_line_input]"
    quote = lambda market: one(f"select id, shipping_cents, total_cents, subtotal_cents, shipping_country, shipping_zone_name, vat_regime, pickup_market_id from public.create_pickup_quote('owner-hash-0123456789', 'es', {lines}, %s)", (mug, market))
    q = quote(ok_m)
    check('a pickup quote: no shipping, Spanish VAT, at the market', q[1:], (0, 1998, 1998, 'ES', 'Mercado de Ruzafa', 'es_vat', ok_m))
    for name, market in (('a market without pickup', no_pickup), ('a market that has ended', ended), ('an unpublished market', draft)):
        denied(f'no pickup at {name}', f"select public.create_pickup_quote('owner-hash-0123456789', 'es', {lines}, %s)", (mug, market), contains='PICKUP_UNAVAILABLE')

    attempt = '77777777-7777-4777-8777-777777777777'
    r = one("select public.reserve_checkout(%s, 'owner-hash-0123456789', %s, 'hash-pickup', 'checkout:pickup')", (attempt, q[0]))[0]
    o = one("select shipping_cents, total_cents, market_id = %s, pickup, shipping_country, vat_regime from orders where id = %s", (ok_m, r['order_id']))
    check('the order is a pickup at that market, with no shipping', o, (0, 1998, True, True, 'ES', 'es_vat'))
    check('its pieces are reserved as any web order', one("select stock_reserved from inventory where product_id = %s", (mug,))[0], 2)

    home = one("select id from public.create_checkout_quote('owner-hash-0123456789', 'es', array[row(%s::uuid, 1)::public.cart_line_input], 'ES', '46001')", (mug,))[0]
    r2 = one("select public.reserve_checkout('88888888-8888-4888-8888-888888888888', 'owner-hash-0123456789', %s, 'hash-home', 'checkout:home')", (home,))[0]
    check('a shipped order is not a pickup', one("select pickup, market_id is null, shipping_cents > 0 from orders where id = %s", (r2['order_id'],)), (False, True, True))
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
