#!/usr/bin/env python3
# Coupons (Admin › Cupones): who may see and edit them, and how coupon_price
# prices a cart (which pieces qualify, the discount, how it is spread over the
# lines, and every reason a code is refused), and the checkout quote priced
# with it (shipping, VAT regimes, pickup, the order and its invoice, the price
# fingerprint), and claiming a use (limits, who, paid orders over the limit).
# One transaction, always rolled back. Runs on the local Docker PostgreSQL.
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-coupons.py
import json, sys, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from psycopg import sql

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
SET_ROLE = {
    'authenticated': 'set local role authenticated',
    'anon': 'set local role anon',
    'service_role': 'set local role service_role',
}

def as_role(role, uid=None):
    cur.execute("reset role")
    if role == 'postgres':
        return
    cur.execute(SET_ROLE[role])
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': role}),))

def denied(name, sql_text, args=(), contains=None):
    cur.execute("savepoint s")
    try:
        cur.execute(sql_text, args)
        check(name, 'allowed', 'denied')
    except Exception as err:
        if contains and contains not in str(err):
            check(name, str(err).splitlines()[0], contains)
        else:
            check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

def one(sql_text, args=()):
    cur.execute(sql_text, args)
    return cur.fetchone()

NOW = datetime.now(timezone.utc)

try:
    adm = '99999999-1111-4111-8111-111111111131'
    ana = '99999999-2222-4222-8222-222222222232'
    ANA = 'ana.cpn@example.com'
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Boss','boss.cpn@example.com',true,now()),(%s,'Ana',%s,true,now())", (adm, ana, ANA))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.cpn@example.com')", (adm,))

    cat_tazas, = one("""insert into categories (code, name_es, name_en, slug_es, slug_en, singular_es, singular_en, sort_order)
                        values ('tazas-cpn','Tazas','Mugs','tazas-cpn','mugs-cpn','Taza','Mug',901) returning id""")
    cat_posa, = one("""insert into categories (code, name_es, name_en, slug_es, slug_en, singular_es, singular_en, sort_order)
                       values ('posavasos-cpn','Posavasos','Coasters','posavasos-cpn','coasters-cpn','Posavasos','Coaster',902) returning id""")
    navidad, = one("insert into shop_collections (code, name_es, name_en) values ('navidad-cpn','Navidad','Christmas') returning id")

    def product(sku, cat, price, collection=None):
        return one("""insert into products (sku, category_id, collection_id, motif, status, price_cents, sale_enabled)
                      values (%s, %s, %s, 'Pug', 'published', %s, true) returning id""", (sku, cat, collection, price))[0]
    taza = product('T-CPN', cat_tazas, 999)
    posa = product('P-CPN', cat_posa, 1200)
    tarjeta = product('C-CPN', cat_posa, 350, navidad)
    PRICE = {taza: 999, posa: 1200, tarjeta: 350}

    peninsula, = one("select id from shipping_zones where 'peninsula' = any(regions)")
    baleares, = one("select id from shipping_zones where 'baleares' = any(regions)")

    def coupon(code, kind, **cols):
        cols = {'code': code, 'kind': kind, **cols}
        q = sql.SQL("insert into coupons ({}) values ({}) returning id").format(
            sql.SQL(', ').join(map(sql.Identifier, cols)), sql.SQL(', ').join(sql.Placeholder() * len(cols)))
        return one(q, list(cols.values()))[0]

    def lines(*items):
        return [{'product_id': str(p), 'quantity': q, 'gross_cents': PRICE[p]} for p, q in items]

    def price(code, items, **ctx):
        as_role('service_role')
        r = one("select public.coupon_price(%s, %s::jsonb, %s::jsonb)", (code, json.dumps(lines(*items)), json.dumps(ctx)))[0]
        as_role('postgres')
        return r

    def units(r):
        return [l['unit_gross_cents'] for l in r['lines']]

    def reason(r):
        return r.get('reason') if not r.get('ok') else 'ok'

    def order(email, status='paid', customer=None):
        paid = 'now()' if status in ('paid', 'refunded', 'partially_refunded') else 'null'
        return one(f"""insert into orders (reference, access_token_hash, payment_status, locale, currency,
                         subtotal_cents, shipping_cents, tax_cents, total_cents, customer_email, customer_id, paid_at)
                       values ('PD-CPN' || substr(md5(random()::text), 1, 8), 'x', %s, 'es', 'EUR', 999, 0, 0, 999, %s, %s, {paid})
                       returning id""", (status, email, customer))[0]

    def redeem(cid, oid, email=None, customer=None):
        cur.execute("insert into coupon_redemptions (coupon_id, order_id, email, customer_id, discount_cents) values (%s,%s,%s,%s,100)",
                    (cid, oid, email, customer))

    # --- The schema ---
    denied('a code is upper-case letters, digits, - and _', "insert into coupons (code, kind, percent) values ('navidad', 'percent', 10)", contains='coupons_code_format')
    denied('a code has 3 to 30 characters', "insert into coupons (code, kind, percent) values ('AB', 'percent', 10)", contains='coupons_code_format')
    denied('a percent coupon needs its percent', "insert into coupons (code, kind) values ('NOPCT', 'percent')", contains='coupons_kind_values')
    denied('a percent is 1 to 100', "insert into coupons (code, kind, percent) values ('PCT101', 'percent', 101)", contains='coupons_value_ranges')
    denied('a fixed coupon needs its amount', "insert into coupons (code, kind) values ('NOFIX', 'fixed')", contains='coupons_kind_values')
    denied('buy X get Y needs both', "insert into coupons (code, kind, buy_qty) values ('NOGET', 'buy_x_get_y', 2)", contains='coupons_kind_values')
    denied('the Nth unit is at least the second', "insert into coupons (code, kind, nth, percent) values ('NTH1', 'nth_unit', 1, 50)", contains='coupons_value_ranges')
    denied('emails are stored lower-case', "insert into coupons (code, kind, percent, emails) values ('MAILS', 'percent', 10, '{Ana@x.com}')", contains='coupons_emails_lower')
    denied('weekdays are 1 to 7', "insert into coupons (code, kind, percent, weekdays) values ('DAYS', 'percent', 10, '{0}')", contains='coupons_weekdays')
    denied('a coupon ends after it starts', "insert into coupons (code, kind, percent, starts_at, ends_at) values ('BACKW', 'percent', 10, now(), now() - interval '1 day')", contains='coupons_dates')

    c10 = coupon('NAVIDAD10', 'percent', percent=10)
    cur.execute("update coupons set min_units = 1 where id = %s", (c10,))
    check('editing a coupon bumps its version', one("select version from coupons where id = %s", (c10,))[0], 2)
    cur.execute("update coupons set note = 'Instagram' where id = %s", (c10,))
    check('a note alone does not change its version', one("select version from coupons where id = %s", (c10,))[0], 2)
    a1 = coupon('ANUNCIO1', 'percent', percent=5, announce=True)
    a2 = coupon('ANUNCIO2', 'percent', percent=5, announce=True)
    check('announcing a coupon stops announcing the previous one', one("select array_agg(code order by code) from coupons where announce")[0], ['ANUNCIO2'])
    cur.execute("update coupons set announce = true where id = %s", (a1,))
    check('and it works on edit too', one("select array_agg(code order by code) from coupons where announce")[0], ['ANUNCIO1'])
    check('announcing does not change the version of the one taken off', one("select version from coupons where id = %s", (a2,))[0], 1)

    # --- Prices ---
    r = price(' navidad10 ', [(taza, 2)])
    check("' navidad10 ' finds NAVIDAD10", (r['ok'], r['code'], r['coupon_id'], r['kind'], r['version']), (True, 'NAVIDAD10', str(c10), 'percent', 2))
    check('10 % on 2 tazas', (r['discount_cents'], units(r), r['shipping_free']), (200, [899], False))

    coupon('TOPE1', 'percent', percent=10, cap_cents=100)
    r = price('TOPE1', [(taza, 2)])
    check('10 % with a 1 € cap', (r['discount_cents'], units(r)), (100, [949]))

    coupon('MENOS5', 'fixed', amount_cents=500)
    r = price('MENOS5', [(taza, 3)])
    check('fixed 5 € on 3 tazas rounds for the customer', (r['discount_cents'], units(r)), (501, [832]))
    r = price('MENOS5', [(taza, 1), (posa, 1)])
    check('spread in proportion, the leftover cent to the largest line', (r['discount_cents'], units(r)), (500, [772, 927]))

    coupon('MENOS50', 'fixed', amount_cents=5000)
    r = price('MENOS50', [(taza, 1)])
    check('a 50 € coupon on a 9,99 € order leaves 0,50 €', (r['discount_cents'], units(r)), (949, [50]))
    r = price('MENOS50', [(taza, 1)], shipping_cents=590)
    check('with shipping charged the piece goes down to 0,01 €, never 0', (r['discount_cents'], units(r)), (998, [1]))
    r = price('MENOS50', [(taza, 3)])
    check('several units never take the order under 0,50 €', units(r)[0] * 3 >= 50 and r['discount_cents'] <= 2997 - 50, True)

    coupon('DOSXUNO', 'buy_x_get_y', buy_qty=1, get_qty=1)
    r = price('DOSXUNO', [(taza, 2)])
    check('2x1 on two tazas spreads the free one', (r['discount_cents'], units(r)), (1000, [499]))
    r = price('DOSXUNO', [(taza, 1), (posa, 1)])
    check('2x1: the cheaper piece is the free one', r['discount_cents'], 999)
    r = price('DOSXUNO', [(taza, 1)])
    check('2x1 with one piece takes nothing off', (r['ok'], r['discount_cents'], units(r)), (True, 0, [999]))

    coupon('SEGUNDA50', 'nth_unit', nth=2, percent=50)
    r = price('SEGUNDA50', [(posa, 2)])
    check('second unit at 50 % on posavasos ×2', (r['discount_cents'], units(r)), (600, [900]))

    coupon('SOLOTAZAS', 'percent', percent=10, category_ids=[cat_tazas])
    r = price('SOLOTAZAS', [(posa, 1), (taza, 2)])
    check('only tazas: the posavasos keeps its price', (r['discount_cents'], units(r), [l['product_id'] for l in r['lines']]), (200, [1200, 899], [str(posa), str(taza)]))
    coupon('POSASINTARJ', 'percent', percent=10, category_ids=[cat_posa], excluded_product_ids=[tarjeta])
    r = price('POSASINTARJ', [(posa, 1), (tarjeta, 1)])
    check('excluded product wins over its category', units(r), [1080, 350])
    coupon('COLNAVIDAD', 'percent', percent=10, collection_ids=[navidad])
    check('a shop collection targets its products', units(price('COLNAVIDAD', [(posa, 1), (tarjeta, 1)])), [1200, 315])
    coupon('SOLOPOSA', 'percent', percent=10, product_ids=[posa])
    check('a product targets itself', units(price('SOLOPOSA', [(posa, 1), (taza, 1)])), [1080, 999])

    coupon('ENVIOGRATIS', 'free_shipping', cap_cents=500)
    r = price('ENVIOGRATIS', [(taza, 1)], shipping_cents=590)
    check('free shipping leaves the pieces alone and says so', (r['discount_cents'], units(r), r['shipping_free'], r['shipping_cap_cents']), (0, [999], True, 500))

    # --- Reasons ---
    check('unknown code', reason(price('NOEXISTE', [(taza, 1)])), 'COUPON_NOT_FOUND')
    check('empty code', reason(price('  ', [(taza, 1)])), 'COUPON_NOT_FOUND')
    p = coupon('PAUSADO', 'percent', percent=10, status='paused')
    check('paused', reason(price('PAUSADO', [(taza, 1)])), 'COUPON_NOT_FOUND')
    coupon('ARCHIVADO', 'percent', percent=10, status='archived')
    check('archived', reason(price('ARCHIVADO', [(taza, 1)])), 'COUPON_NOT_FOUND')
    coupon('MANANA', 'percent', percent=10, starts_at=NOW + timedelta(days=1))
    check('starts_at tomorrow', reason(price('MANANA', [(taza, 1)])), 'COUPON_NOT_STARTED')
    coupon('AYER', 'percent', percent=10, ends_at=NOW - timedelta(days=1))
    check('ends_at yesterday', reason(price('AYER', [(taza, 1)])), 'COUPON_EXPIRED')
    coupon('VIGENTE', 'percent', percent=10, starts_at=NOW - timedelta(days=1), ends_at=NOW + timedelta(days=1))
    check('between its dates', reason(price('VIGENTE', [(taza, 1)])), 'ok')
    w = coupon('OTRODIA', 'percent', percent=10)
    cur.execute("""update coupons set weekdays = (select array_agg(d::smallint) from generate_series(1, 7) d
                   where d <> extract(isodow from now() at time zone 'Europe/Madrid')) where id = %s""", (w,))
    check('weekdays without today', reason(price('OTRODIA', [(taza, 1)])), 'COUPON_WRONG_DAY')
    cur.execute("update coupons set weekdays = array[extract(isodow from now() at time zone 'Europe/Madrid')::smallint] where id = %s", (w,))
    check('weekdays with today', reason(price('OTRODIA', [(taza, 1)])), 'ok')
    check('no qualifying piece', reason(price('SOLOTAZAS', [(posa, 1)])), 'COUPON_NO_ITEMS')
    coupon('MIN30', 'percent', percent=10, min_subtotal_cents=3000)
    r = price('MIN30', [(taza, 1)])
    check('min 30 € with 9,99 €', (reason(r), r.get('missing_cents')), ('COUPON_MIN_SUBTOTAL', 2001))
    coupon('MIN30TAZAS', 'percent', percent=10, min_subtotal_cents=3000, category_ids=[cat_tazas])
    check('the minimum counts qualifying pieces only', reason(price('MIN30TAZAS', [(taza, 1), (posa, 3)])), 'COUPON_MIN_SUBTOTAL')
    coupon('MIN3UDS', 'percent', percent=10, min_units=3)
    r = price('MIN3UDS', [(taza, 2)])
    check('min 3 units with 2', (reason(r), r.get('missing_units')), ('COUPON_MIN_UNITS', 1))
    coupon('PENINSULA', 'percent', percent=10, zone_ids=[peninsula])
    check('zone not allowed', reason(price('PENINSULA', [(taza, 1)], zone_id=str(baleares))), 'COUPON_ZONE')
    check('zone allowed', reason(price('PENINSULA', [(taza, 1)], zone_id=str(peninsula))), 'ok')
    check('no destination yet: the zone is judged later', reason(price('PENINSULA', [(taza, 1)])), 'ok')
    coupon('SINRECOGIDA', 'percent', percent=10, allow_pickup=False)
    check('allow_pickup false with pickup', reason(price('SINRECOGIDA', [(taza, 1)], pickup=True)), 'COUPON_PICKUP')
    check('allow_pickup false when shipped', reason(price('SINRECOGIDA', [(taza, 1)], zone_id=str(peninsula))), 'ok')
    coupon('SOLORECOGIDA', 'percent', percent=10, allow_shipping=False)
    check('allow_shipping false when shipped', reason(price('SOLORECOGIDA', [(taza, 1)], zone_id=str(peninsula))), 'COUPON_SHIPPING')
    check('allow_shipping false with pickup', reason(price('SOLORECOGIDA', [(taza, 1)], pickup=True)), 'ok')

    first = coupon('PRIMERA', 'percent', percent=10, first_order_only=True)
    order(ANA)
    check('first_order_only with a paid order on that email', reason(price('PRIMERA', [(taza, 1)], email='Ana.Cpn@example.com')), 'COUPON_FIRST_ORDER')
    check('first_order_only with a new email', reason(price('PRIMERA', [(taza, 1)], email='nueva.cpn@example.com')), 'ok')
    order('otra.cpn@example.com', status='checkout_open')
    check('an unpaid order is not a first order', reason(price('PRIMERA', [(taza, 1)], email='otra.cpn@example.com')), 'ok')
    check('who-rules wait until the email is known', reason(price('PRIMERA', [(taza, 1)])), 'ok')
    coupon('CONCUENTA', 'percent', percent=10, require_account=True)
    check('require_account without customer', reason(price('CONCUENTA', [(taza, 1)], email='x.cpn@example.com')), 'COUPON_ACCOUNT')
    check('require_account even before the email is known', reason(price('CONCUENTA', [(taza, 1)])), 'COUPON_ACCOUNT')
    check('require_account signed in', reason(price('CONCUENTA', [(taza, 1)], customer_id=ana, email=ANA)), 'ok')
    coupon('PERSONAL', 'percent', percent=10, emails=['lucia.cpn@example.com'])
    check('email not in list', reason(price('PERSONAL', [(taza, 1)], email='x.cpn@example.com')), 'COUPON_EMAIL')
    check('email in list, any case', reason(price('PERSONAL', [(taza, 1)], email=' Lucia.Cpn@Example.com ')), 'ok')
    coupon('PERSONALCTA', 'percent', percent=10, emails=[ANA], emails_require_account=True)
    check('emails_require_account with the right email but signed out', reason(price('PERSONALCTA', [(taza, 1)], email=ANA)), 'COUPON_EMAIL')
    check('emails_require_account signed in as that email', reason(price('PERSONALCTA', [(taza, 1)], email=ANA, customer_id=ana)), 'ok')
    check('a signed-in customer is checked by the account email', reason(price('PERSONALCTA', [(taza, 1)], customer_id=ana)), 'ok')

    once = coupon('UNAVEZ', 'percent', percent=10, max_uses=1)
    paid = order('b.cpn@example.com')
    redeem(once, paid, 'b.cpn@example.com')
    check('max_uses 1 with one paid redemption', reason(price('UNAVEZ', [(taza, 1)])), 'COUPON_SOLD_OUT')
    check('but not for the order that holds it', reason(price('UNAVEZ', [(taza, 1)], order_id=str(paid))), 'ok')
    once2 = coupon('UNAVEZ2', 'percent', percent=10, max_uses=1)
    redeem(once2, order('c.cpn@example.com', status='cancelled'), 'c.cpn@example.com')
    redeem(once2, order('d.cpn@example.com', status='expired'), 'd.cpn@example.com')
    check('max_uses 1 with one cancelled (and one expired)', reason(price('UNAVEZ2', [(taza, 1)])), 'ok')
    per = coupon('UNOPORCLIENTE', 'percent', percent=10, max_uses_per_customer=1)
    redeem(per, order(ANA, customer=ana), ANA, ana)
    check('used by that email', reason(price('UNOPORCLIENTE', [(taza, 1)], email='ANA.cpn@example.com')), 'COUPON_USED')
    check('used by that account', reason(price('UNOPORCLIENTE', [(taza, 1)], email='alias.cpn@example.com', customer_id=ana)), 'COUPON_USED')
    check('another customer may use it', reason(price('UNOPORCLIENTE', [(taza, 1)], email='e.cpn@example.com')), 'ok')
    check('coupon_uses counts total and by customer', one("select total, by_customer from public.coupon_uses(%s, %s, null, null)", (per, ANA)), (1, 1))

    # --- Checkout quotes priced with the coupon ---
    CONFIG = json.dumps({
        'issuerName': 'MEILI STRINGFELLOW PRUEBA', 'issuerNif': '89890001K', 'issuerAddress': 'Calle Mayor 1',
        'issuerPostalCode': '28013', 'issuerCity': 'Madrid', 'issuerKind': 'autonomo',
        'simplifiedPrefix': 'T', 'fullPrefix': 'U', 'rectifyingPrefix': 'V', 'shippingVatRate': 21, 'verifactuEnabled': False,
    })
    cur.execute("insert into shop_settings (id) values (1) on conflict (id) do nothing")
    cur.execute("update shop_settings set sales_enabled = true, payments_enabled = true, invoice_config = %s::jsonb where id = 1", (CONFIG,))
    for pid, slug in ((taza, 'taza'), (posa, 'posavasos'), (tarjeta, 'tarjeta')):
        cur.execute("insert into product_translations (product_id, locale, slug, title) values (%s, 'es', %s, %s), (%s, 'en', %s, %s)",
                    (pid, slug + '-cpn', slug.capitalize(), pid, slug + '-cpn-en', slug.capitalize()))
        cur.execute("""insert into inventory (product_id, inventory_mode, stock_on_hand, verified_at) values (%s, 'tracked', 50, now())
                       on conflict (product_id) do update set inventory_mode = 'tracked', stock_on_hand = 50, stock_reserved = 0, verified_at = now()""", (pid,))
    OWNER = 'owner-hash-coupons-0001'
    COLS = """id, subtotal_cents, shipping_cents, total_cents, lines, coupon_id::text, coupon_code, coupon_discount_cents,
              coupon_error, coupon_missing_cents, coupon_missing_units, price_fingerprint, vat_regime, vat_discount_cents"""
    Q = ('id', 'subtotal', 'shipping', 'total', 'lines', 'coupon_id', 'coupon_code', 'discount', 'error', 'missing_cents',
         'missing_units', 'fingerprint', 'regime', 'vat_discount')

    def cart(*items):
        return "array[" + ", ".join(f"row('{p}'::uuid, {q})::public.cart_line_input" for p, q in items) + "]"

    def quote(items, cp='46001', code=None, ctx=None, country='ES', owner=OWNER):
        return dict(zip(Q, one(f"""select {COLS} from public.create_checkout_quote(p_cart_owner_hash => %s, p_locale => 'es',
                                    p_lines => {cart(*items)}, p_country => %s, p_postal_code => %s, p_invoice_customer => null,
                                    p_coupon_code => %s, p_coupon_ctx => %s::jsonb)""",
                               (owner, country, cp, code, json.dumps(ctx) if ctx is not None else None))))

    def pickup_quote(items, market, code=None, ctx=None):
        return dict(zip(Q, one(f"""select {COLS} from public.create_pickup_quote(p_cart_owner_hash => %s, p_locale => 'es',
                                    p_lines => {cart(*items)}, p_market_id => %s, p_invoice_customer => null,
                                    p_coupon_code => %s, p_coupon_ctx => %s::jsonb)""",
                               (OWNER, market, code, json.dumps(ctx) if ctx is not None else None))))

    def ship(items, cp, discount=0):
        return one(f"select public.shipping_quote({cart(*items)}, 'ES', %s, %s)", (cp, discount))[0]

    net = lambda cents, rate=21: one("select public.net_cents(%s, %s)", (cents, rate))[0]
    line = lambda q, i=0: {k: q['lines'][i][k] for k in ('catalog_price_cents', 'list_unit_cents', 'unit_price_cents', 'line_subtotal_cents')}

    q = quote([(taza, 2)], code=' navidad10 ')
    check('quote with NAVIDAD10 charges 8,99 € per taza and keeps the catalogue price',
          (line(q), q['subtotal'], q['coupon_id'], q['coupon_code'], q['discount'], q['error']),
          ({'catalog_price_cents': 999, 'list_unit_cents': 999, 'unit_price_cents': 899, 'line_subtotal_cents': 1798}, 1798, str(c10), 'NAVIDAD10', 200, None))
    check('and the total is the discounted pieces plus shipping', q['total'], 1798 + q['shipping'])
    plain = quote([(taza, 2)])
    check('a quote with no code: list price = charged price, no coupon', (line(plain)['list_unit_cents'], line(plain)['unit_price_cents'], plain['coupon_code'], plain['discount'], plain['error']), (999, 999, None, 0, None))

    check('free shipping is judged after the discount: 5 posavasos (60 €) ship free', quote([(posa, 5)])['shipping'], 0)
    q = quote([(posa, 5)], code='NAVIDAD10')
    s = ship([(posa, 5)], '46001', 600)
    check('but with 10 % off (54 €) the shipping is charged', (q['subtotal'], q['shipping'] > 0, q['shipping'], q['total']),
          (5400, True, s['shipping_cents'], 5400 + s['shipping_cents']))
    check('shipping_quote compares the free-shipping threshold after the discount', (ship([(posa, 5)], '46001')['shipping_cents'], ship([(posa, 5)], '46001', 599)['shipping_cents'] > 0), (0, True))
    check('shipping_quote still works with three arguments, by name', one(f"select (public.shipping_quote(p_lines => {cart((taza, 1))}, p_country => 'ES', p_postal_code => '46001'))->>'available'")[0], 'true')

    q = quote([(taza, 1)], code='ENVIOGRATIS')
    check('free-shipping coupon zeroes the Península shipping', (ship([(taza, 1)], '46001')['shipping_cents'], q['shipping'], q['total'], q['discount'], q['error']), (490, 0, 999, 490, None))
    q = quote([(taza, 1)], cp='07001', code='ENVIOGRATIS')
    check('the free-shipping cap (5 €) leaves the rest of the Baleares shipping to pay', (q['shipping'], q['discount'], q['total']), (190, 500, 1189))

    market, = one("insert into markets (name, city, starts_on, ends_on, pickup) values ('Mercado CPN', 'Valencia', current_date + 3, current_date + 5, true) returning id")
    coupon('ENVIOSINRECOGIDA', 'free_shipping', allow_pickup=False)
    q = pickup_quote([(taza, 1)], market, code='EnvioSinRecogida')
    check('free-shipping coupon on pickup gives COUPON_PICKUP, shipping stays 0', (q['error'], q['coupon_id'], q['coupon_code'], q['shipping'], q['total'], q['discount']),
          ('COUPON_PICKUP', None, 'ENVIOSINRECOGIDA', 0, 999, 0))
    q = pickup_quote([(taza, 1)], market, code='ENVIOGRATIS')
    check('a free-shipping coupon that allows pickup saves nothing there', (q['error'], q['coupon_code'], q['shipping'], q['total'], q['discount']), (None, 'ENVIOGRATIS', 0, 999, 0))
    q = pickup_quote([(taza, 2)], market, code='NAVIDAD10')
    check('a pickup quote takes the coupon', (line(q)['unit_price_cents'], q['total'], q['discount'], q['regime']), (899, 1798, 200, 'es_vat'))
    check('a pickup-only coupon works at a market', pickup_quote([(taza, 1)], market, code='SOLORECOGIDA')['error'], None)
    check('but a shipped quote cannot claim to be a pickup', quote([(taza, 1)], code='SOLORECOGIDA', ctx={'pickup': True})['error'], 'COUPON_SHIPPING')
    check('nor move the clock', quote([(taza, 1)], code='AYER', ctx={'at': (NOW - timedelta(days=3)).isoformat()})['error'], 'COUPON_EXPIRED')
    check('the zone comes from the destination', (quote([(taza, 1)], cp='07001', code='PENINSULA')['error'], quote([(taza, 1)], code='PENINSULA')['error']), ('COUPON_ZONE', None))
    check('before an address a zone coupon is not refused for its zone', quote([(taza, 1)], cp=None, country=None, code='PENINSULA')['error'], None)
    check('the email in the context is judged', (quote([(taza, 1)], code='PERSONAL', ctx={'email': 'x.cpn@example.com'})['error'],
                                                  quote([(taza, 1)], code='PERSONAL', ctx={'email': 'lucia.cpn@example.com'})['error']), ('COUPON_EMAIL', None))

    q = quote([(taza, 1)], cp='38001', code='NAVIDAD10')
    s = ship([(taza, 1)], '38001', 100)
    check('Canarias pays the net of the discounted price', (q['regime'], line(q)), ('no_vat', {'catalog_price_cents': 999, 'list_unit_cents': net(999), 'unit_price_cents': net(899), 'line_subtotal_cents': net(899)}))
    check('and its VAT taken is the discounted pieces plus shipping', (q['vat_discount'], q['discount'], q['total']),
          (899 - net(899) + s['shipping_vat_taken_cents'], net(999) - net(899), net(899) + s['shipping_cents']))
    check('shipping_quote says how much VAT it took off the shipping', (s['shipping_vat_taken_cents'], ship([(taza, 1)], '46001')['shipping_vat_taken_cents']), (990 - net(990), 0))
    q = quote([(taza, 1)], cp='38001', code='ENVIOGRATIS')
    check('in Canarias the free-shipping cap (5 €) is with VAT; the rest is charged net', (q['shipping'], q['discount'], q['vat_discount'], q['total']),
          (net(490), net(990) - net(490), 999 - net(999) + 490 - net(490), net(999) + net(490)))
    q = quote([(taza, 1)], cp='38001')
    check('Canarias without a coupon is priced as before', (line(q)['unit_price_cents'], q['vat_discount']), (net(999), 999 - net(999) + 990 - net(990)))

    q = quote([(taza, 1), (posa, 1)], code='SOLOTAZAS')
    check('only tazas: 10 % off the taza', (q['discount'], q['error']), (100, None))
    q = quote([(posa, 1)], code='SOLOTAZAS')
    check('removing the only taza drops the discount with COUPON_NO_ITEMS', (q['error'], q['coupon_id'], q['coupon_code'], q['discount'], line(q)['unit_price_cents'], q['subtotal']),
          ('COUPON_NO_ITEMS', None, 'SOLOTAZAS', 0, 1200, 1200))

    q = quote([(taza, 2)], code='noexiste')
    check('a bad code still gives a quote without discount', (q['error'], q['coupon_code'], q['discount'], q['total'], q['fingerprint']),
          ('COUPON_NOT_FOUND', 'NOEXISTE', 0, plain['total'], plain['fingerprint']))
    check('a blank code is no code', (quote([(taza, 2)], code='  ')['error'], quote([(taza, 2)], code='  ')['coupon_code']), (None, None))
    check('the quote says how much is missing for the minimum', (lambda r: (r['error'], r['missing_cents']))(quote([(taza, 1)], code='MIN30')), ('COUPON_MIN_SUBTOTAL', 2001))
    check('and how many pieces', (lambda r: (r['error'], r['missing_units']))(quote([(taza, 2)], code='MIN3UDS')), ('COUPON_MIN_UNITS', 1))

    q = quote([(taza, 2)], code='NAVIDAD10')
    res = one("select public.reserve_checkout('c1777777-7777-4777-8777-000000000001', %s, %s, 'hash-cpn1', 'checkout:cpn1')", (OWNER, q['id']))[0]
    oid = res['order_id']
    check('reserving copies the coupon onto the order', one("select coupon_id::text, coupon_code, coupon_discount_cents, total_cents from orders where id = %s", (oid,)),
          (str(c10), 'NAVIDAD10', 200, q['total']))
    check("the order's line price is the discounted one", one("select unit_price_cents, quantity, line_subtotal_cents from order_items where order_id = %s", (oid,)), (899, 2, 1798))
    one("select public.apply_payment(%s, 'evt_cpn1', 'cs_cpn1', 'pi_cpn1', %s, 'EUR', 'pago.cpn@example.com', 'Pago', null)", (oid, q['total']))
    inv = one("select lines->0, total_cents, base_cents + vat_cents from invoices where order_id = %s", (oid,))
    check('and its invoice base matches', ({k: inv[0][k] for k in ('quantity', 'unitNetCents', 'baseCents', 'totalCents')}, inv[1], inv[2]),
          ({'quantity': 2, 'unitNetCents': net(899), 'baseCents': net(1798), 'totalCents': 1798}, q['total'], q['total']))

    pausa = coupon('PAUSAME', 'percent', percent=10)
    old = quote([(taza, 2)], code='PAUSAME')
    cur.execute("update coupons set status = 'paused' where id = %s", (pausa,))
    new = quote([(taza, 2)], code='PAUSAME')
    check('pausing the coupon makes the old quote\'s fingerprint stale', (old['error'], new['error'], old['fingerprint'] != new['fingerprint']), (None, 'COUPON_NOT_FOUND', True))
    denied('so the old quote cannot be reserved', "select public.reserve_checkout('c2777777-7777-4777-8777-000000000002', %s, %s, 'hash-cpn2', 'checkout:cpn2')", (OWNER, old['id']), contains='PRICE_CHANGED')
    cur.execute("update coupons set status = 'active' where id = %s", (pausa,))
    denied('active again it is a new version: the old quote stays stale', "select public.reserve_checkout('c3777777-7777-4777-8777-000000000003', %s, %s, 'hash-cpn3', 'checkout:cpn3')", (OWNER, old['id']), contains='PRICE_CHANGED')
    old = quote([(taza, 2)], code='PAUSAME')
    cur.execute("update coupons set note = 'Instagram' where id = %s", (pausa,))
    check('a new note does not', one("select public.reserve_checkout('c5777777-7777-4777-8777-000000000005', %s, %s, 'hash-cpn5', 'checkout:cpn5')", (OWNER, old['id']))[0]['order_id'] is not None, True)
    old = quote([(taza, 2)], code='PAUSAME')
    cur.execute("update coupons set percent = 20 where id = %s", (pausa,))
    denied('changing a rule of the coupon also makes the old quote stale', "select public.reserve_checkout('c4777777-7777-4777-8777-000000000004', %s, %s, 'hash-cpn4', 'checkout:cpn4')", (OWNER, old['id']), contains='PRICE_CHANGED')

    # --- Claiming a use when checkout opens, and paid orders over the limit ---
    def checkout(items, code, email=None, customer=None, cp='46001', ctx=None, market=None, owner=OWNER, country='ES'):
        q = pickup_quote(items, market, code=code, ctx=ctx) if market else quote(items, cp=cp, code=code, ctx=ctx, owner=owner, country=country)
        aid = str(uuid.uuid4())
        oid = one("select (public.reserve_checkout(%s, %s, %s, %s, %s))->>'order_id'", (aid, owner, q['id'], 'hash-' + aid, 'checkout:' + aid))[0]
        cur.execute("update orders set customer_email = %s, customer_id = %s where id = %s", (email, customer, oid))
        return q, oid, aid

    def claim(oid):
        as_role('service_role')
        r = one("select public.claim_order_coupon(%s)", (oid,))[0]
        as_role('postgres')
        return r

    def refused(name, oid, why):
        as_role('service_role')
        denied(name, "select public.claim_order_coupon(%s)", (oid,), contains=why)
        as_role('postgres')

    def pay(oid, email=None):
        total, = one("select total_cents from orders where id = %s", (oid,))
        return one("select public.apply_payment(%s, %s, %s, %s, %s, 'EUR', %s, 'Pago', null)",
                   (oid, 'evt_' + oid, 'cs_' + oid, 'pi_' + oid, total, email))[0]['status']

    def uses(oid):
        return one("select count(*) from coupon_redemptions where order_id = %s", (oid,))[0]

    def flagged(oid):
        return one("select payment_status::text, paid_at is not null, coupon_over_limit from orders where id = %s", (oid,))

    cl = coupon('CLAIM10', 'percent', percent=10, max_uses=5)
    q, o1, _ = checkout([(taza, 2)], 'CLAIM10', email='Claim.Cpn@example.com')
    first_claim, second_claim = claim(o1), claim(o1)
    check('claim inserts one redemption, twice is still one', (first_claim['claimed'], second_claim['claimed'], uses(o1)), (True, True, 1))
    check('the redemption holds the coupon, the email and what the order saved',
          one("select coupon_id::text, email, discount_cents from coupon_redemptions where order_id = %s", (o1,)), (str(cl), 'claim.cpn@example.com', q['discount']))
    check('an order without a coupon claims nothing', claim(checkout([(taza, 1)], None)[1]), {'claimed': False})

    pz = coupon('PAUSATRAS', 'percent', percent=10)
    _, o2, _ = checkout([(taza, 1)], 'PAUSATRAS', email='p.cpn@example.com')
    cur.execute("update coupons set status = 'paused' where id = %s", (pz,))
    refused('claim refuses a coupon paused after the quote', o2, 'COUPON_NOT_FOUND')
    check('and records no use', uses(o2), 0)

    coupon('UNOCLAIM', 'percent', percent=10, max_uses_per_customer=1)
    _, oa, _ = checkout([(taza, 1)], 'UNOCLAIM', email='rep.cpn@example.com')
    _, ob, _ = checkout([(taza, 1)], 'UNOCLAIM', email='REP.cpn@example.com')
    claim(oa)
    refused('claim refuses per-customer reuse', ob, 'COUPON_USED')

    coupon('ULTIMO', 'percent', percent=10, max_uses=1)
    _, ox, _ = checkout([(taza, 1)], 'ULTIMO', email='x1.cpn@example.com')
    _, oy, _ = checkout([(taza, 1)], 'ULTIMO', email='y1.cpn@example.com')
    check('the first of two orders takes the last use', claim(ox)['claimed'], True)
    refused('the last use goes to one order only', oy, 'COUPON_SOLD_OUT')
    fn, = one("select pg_get_functiondef('public.claim_order_coupon(uuid)'::regprocedure)")
    check('the claim locks the coupon row before it counts the uses', 0 < fn.find('FOR NO KEY UPDATE') < fn.find('coupon_price('), True)
    one("select public.cancel_unpaid_order(%s)", (ox,))
    check('a cancelled order frees its use', claim(oy)['claimed'], True)

    # Back from the payment page, «Pagar» again: a new order. The same cart
    # owner's open orders holding this coupon end first (expired, as their
    # session would), so the new one is not refused for the use the abandoned
    # one still holds.
    def release(oid):
        as_role('service_role')
        r = one("select public.release_owner_coupon_orders(%s)", (oid,))[0]
        as_role('postgres')
        return r

    def status(oid):
        return one("select payment_status::text from orders where id = %s", (oid,))[0]

    def held(cid, email):
        return one("select total, by_customer from public.coupon_uses(%s, %s, null, null)", (cid, email))

    OTHER = 'owner-hash-coupons-0002'
    once_back = coupon('OTRAVEZ', 'percent', percent=10, max_uses_per_customer=1)
    _, back1, back1_attempt = checkout([(taza, 1)], 'OTRAVEZ', email='back.cpn@example.com')
    claim(back1)
    cur.execute("update checkout_attempts set stripe_session_id = 'cs_test_back1' where id = %s", (back1_attempt,))
    coupon('OTRO10', 'percent', percent=10)
    _, other_cpn, _ = checkout([(taza, 1)], 'OTRO10', email='back.cpn@example.com')
    claim(other_cpn)
    _, back2, _ = checkout([(taza, 1)], 'OTRAVEZ', email='back.cpn@example.com')
    check('«Pagar» again releases the same owner\'s open order holding the coupon, with its Stripe session',
          release(back2), [{'order_id': back1, 'stripe_session_id': 'cs_test_back1'}])
    check('that order ends as its session would have (expired), stock back, its use no longer counts',
          (status(back1), one("select count(*) from stock_reservations r join checkout_attempts a on a.id = r.checkout_attempt_id where a.order_id = %s and r.status = 'active'", (back1,))[0],
           held(once_back, 'back.cpn@example.com')), ('expired', 0, (0, 0)))
    check('an open order of the same owner with another coupon is left alone', status(other_cpn), 'pending_session')
    check('so the second checkout takes the once-per-customer coupon', claim(back2)['claimed'], True)
    check('releasing again finds nothing more (the order itself is never released)', release(back2), [])
    _, theirs, _ = checkout([(taza, 1)], 'OTRAVEZ', email='back.cpn@example.com', owner=OTHER)
    check('another cart owner releases nothing', release(theirs), [])
    refused('so the open order of the first owner still counts for that email', theirs, 'COUPON_USED')
    check('and stays open', status(back2), 'pending_session')
    check('an order without a coupon releases nothing', release(checkout([(taza, 1)], None)[1]), [])
    _, back3, _ = checkout([(taza, 1)], 'OTRAVEZ', email='back.cpn@example.com')
    pay(back2)
    check('a paid order is never released', (release(back3), status(back2)), ([], 'paid'))
    refused('and its use still counts', back3, 'COUPON_USED')
    check('the released order paid anyway (its session not expired in time) lands in review, flagged over the limit',
          (pay(back1), flagged(back1)), ('review', ('review', True, True)))

    # max_uses 1: one order's use lapses (expired), another takes it (the
    # holder), and a third never claimed it. Only the two that did not hold
    # the use are flagged, whichever is paid first.
    def lapse_case(code):
        coupon(code, 'percent', percent=10, max_uses=1)
        tag = code.lower()
        _, lapsed, attempt = checkout([(taza, 1)], code, email=f'e.{tag}.cpn@example.com')
        _, never, _ = checkout([(taza, 1)], code, email=f'g.{tag}.cpn@example.com')
        claim(lapsed)
        one("select public.release_reservations(%s, 'expired')", (attempt,))
        _, holder, _ = checkout([(taza, 1)], code, email=f'f.{tag}.cpn@example.com')
        return lapsed, never, holder, claim(holder)['claimed']

    lapsed, never, holder, took = lapse_case('CADUCA')
    check('an expired order frees its use for another', took, True)
    pay(lapsed)
    pay(never)
    pay(holder)
    # The lapsed one's stock was released, so apply_payment sends it to review
    # (as before coupons); the coupon only adds the flag.
    check('paid after its use lapsed: accepted and flagged over limit (paid before the holder)', (flagged(lapsed), uses(lapsed)), (('review', True, True), 1))
    check('a paid order that never claimed its use gets one, flagged over limit (before the holder)', (flagged(never), uses(never)), (('paid', True, True), 1))
    check('the holder, paid last, is not flagged', flagged(holder), ('paid', True, False))

    lapsed, never, holder, _ = lapse_case('CADUCA2')
    pay(holder)
    pay(never)
    pay(lapsed)
    check('the holder, paid first, is not flagged', flagged(holder), ('paid', True, False))
    check('the never-claimed one, paid after the holder, is flagged', (flagged(never), uses(never)), (('paid', True, True), 1))
    check('the lapsed one, paid last, is flagged', flagged(lapsed), ('review', True, True))

    coupon('GUEST1', 'percent', percent=10, max_uses_per_customer=1)
    _, oh, _ = checkout([(taza, 1)], 'GUEST1', email='h1.cpn@example.com')
    claim(oh)
    pay(oh)
    _, oi, _ = checkout([(taza, 1)], 'GUEST1')
    refused('an order with no email cannot claim a once-per-customer coupon', oi, 'COUPON_EMAIL')
    check('but may claim one that does not care who', claim(checkout([(taza, 1)], 'CLAIM10')[1])['claimed'], True)
    _, oi2, _ = checkout([(taza, 1)], 'GUEST1', email='i2.cpn@example.com')
    claim(oi2)
    check('claimed by A, paid by B who used it already: flagged', (pay(oi2, 'H1.cpn@example.com'), flagged(oi2)), ('paid', ('paid', True, True)))
    check('the use keeps the claim email A and records the payer B', one("select email, payer_email from coupon_redemptions where order_id = %s", (oi2,)),
          ('i2.cpn@example.com', 'h1.cpn@example.com'))
    refused('so A cannot claim the coupon again', checkout([(taza, 1)], 'GUEST1', email='I2.cpn@example.com')[1], 'COUPON_USED')
    _, oj2, _ = checkout([(taza, 1)], 'GUEST1', email='j2.cpn@example.com')
    claim(oj2)
    check('claimed by A, paid by a new B: not flagged', (pay(oj2, 'k2.cpn@example.com'), flagged(oj2)), ('paid', ('paid', True, False)))
    refused('and B cannot claim it either', checkout([(taza, 1)], 'GUEST1', email='K2.cpn@example.com')[1], 'COUPON_USED')
    check('a use never claimed, paid by someone who used it already, is flagged and takes that email',
          (pay(oi, 'H1.cpn@example.com'), flagged(oi), one("select email from coupon_redemptions where order_id = %s", (oi,))[0]),
          ('paid', ('paid', True, True), 'h1.cpn@example.com'))

    refused('an order with no email cannot claim an email-list coupon', checkout([(taza, 1)], 'PERSONAL')[1], 'COUPON_EMAIL')
    refused('nor a first-order coupon', checkout([(taza, 1)], 'PRIMERA')[1], 'COUPON_EMAIL')
    _, oq, _ = checkout([(taza, 1)], 'PERSONAL', email='lucia.cpn@example.com')
    claim(oq)
    check('a personal coupon paid by the listed email is not flagged', (pay(oq, 'Lucia.Cpn@example.com'), flagged(oq)), ('paid', ('paid', True, False)))
    _, or_, _ = checkout([(taza, 1)], 'PERSONAL', email='lucia.cpn@example.com')
    claim(or_)
    check('paid with an email off the list after the claim: accepted and flagged', (pay(or_, 'otra.persona.cpn@example.com'), flagged(or_)), ('paid', ('paid', True, True)))
    _, os_, _ = checkout([(taza, 1)], 'PRIMERA', email='nueva2.cpn@example.com')
    claim(os_)
    check('a first-order coupon paid with an email that has paid before is flagged', (pay(os_, ANA), flagged(os_)), ('paid', ('paid', True, True)))

    _, oj, _ = checkout([(taza, 1)], 'PRIMERA', email=ANA)
    refused('first-order coupon refused at claim when the email has a paid order', oj, 'COUPON_FIRST_ORDER')
    coupon('MIACUENTA', 'percent', percent=10, require_account=True, emails=[ANA], emails_require_account=True)
    _, ok_, _ = checkout([(taza, 1)], 'MIACUENTA', email=ANA, customer=ana, ctx={'customer_id': ana})
    check('require_account + emails: signed-in account with that email passes', claim(ok_)['claimed'], True)
    cur.execute("update orders set customer_id = null where id = %s", (ok_,))
    cur.execute("delete from coupon_redemptions where order_id = %s", (ok_,))
    refused('but not signed out', ok_, 'COUPON_ACCOUNT')

    q, ol, _ = checkout([(posa, 5)], 'ENVIOGRATIS', email='l1.cpn@example.com')
    check('a free-shipping coupon on an order that ships free saves nothing', (q['error'], q['shipping'], q['discount']), (None, 0, 0))
    check('so its claim takes no use', (claim(ol), uses(ol)), ({'claimed': False, 'reason': 'NO_SAVING'}, 0))
    check('nor does its payment', (pay(ol), uses(ol)), ('paid', 0))

    q, om, _ = checkout([(taza, 1)], 'ENVIOGRATIS', email='m1.cpn@example.com')
    check('a free-shipping coupon that saved the shipping claims a use', (q['discount'], claim(om)['claimed'], uses(om)), (490, True, 1))
    q, on_, _ = checkout([(taza, 2)], 'CLAIM10', email='n1.cpn@example.com', cp='38001')
    check('a Canarias order (net prices) claims without a false change', (q['regime'], claim(on_)['claimed']), ('no_vat', True))
    q, oc, _ = checkout([(taza, 1)], 'ENVIOGRATIS', email='c1.cpn@example.com', cp='38001')
    check('and so does a free-shipping one there', (q['discount'] > 0, claim(oc)['claimed']), (True, True))
    _, op, _ = checkout([(taza, 2)], 'CLAIM10', email='p1.cpn@example.com', market=market)
    check('a pickup order claims its use', claim(op)['claimed'], True)

    # With no shipping, MENOS50 stops at the 0,50 € floor; once shipping is
    # charged again the same coupon would take more off.
    rates = cur.execute("select max_grams, price_cents from shipping_rates where zone_id = %s", (peninsula,)).fetchall()
    cur.execute("update shipping_rates set price_cents = 0 where zone_id = %s", (peninsula,))
    _, ow, _ = checkout([(taza, 1)], 'MENOS50', email='w1.cpn@example.com')
    for grams, cents in rates:
        cur.execute("update shipping_rates set price_cents = %s where zone_id = %s and max_grams = %s", (cents, peninsula, grams))
    check('MENOS50 with free shipping keeps the taza at 0,50 €', one("select unit_price_cents from order_items where order_id = %s", (ow,))[0], 50)
    refused('a discount that would now be different is COUPON_CHANGED', ow, 'COUPON_CHANGED')

    coupon('TODOGRATIS', 'percent', percent=100)
    for cp, place in (('46001', 'Península'), ('38001', 'Canarias (no_vat)')):
        q, ot, _ = checkout([(taza, 2), (posa, 1)], 'TODOGRATIS', email=f'gratis{cp}.cpn@example.com', cp=cp)
        items = cur.execute("select unit_price_cents from order_items where order_id = %s", (ot,)).fetchall()
        check(f'a 100 % coupon with shipping charged reserves in {place}, every unit at least 1 cent',
              (q['shipping'] > 0, len(items), min(u for u, in items) >= 1, q['total'] >= 50), (True, 2, True, True))
        check(f'and claims its use in {place}', claim(ot)['claimed'], True)

    nowhere = quote([(taza, 1)], cp=None, country=None, code='PENINSULA')
    denied('a quote with no destination cannot be reserved, so the claim always judges the zone',
           "select public.reserve_checkout('c6777777-7777-4777-8777-000000000006', %s, %s, 'hash-cpn6', 'checkout:cpn6')", (OWNER, nowhere['id']), contains='SHIPPING_REQUIRED')
    _, outside, _ = checkout([(taza, 1)], 'PENINSULA', email='z1.cpn@example.com')
    cur.execute("update coupons set zone_ids = %s where code = 'PENINSULA'", ([baleares],))
    refused('a zone coupon is refused at claim for an order shipped outside its zones', outside, 'COUPON_ZONE')

    as_role('anon')
    denied('anon cannot claim a use', "select public.claim_order_coupon(%s)", (o1,), contains='permission denied')
    denied('nor release a cart owner\'s orders', "select public.release_owner_coupon_orders(%s)", (o1,), contains='permission denied')
    as_role('authenticated', ana)
    denied('nor a customer', "select public.claim_order_coupon(%s)", (o1,), contains='permission denied')
    as_role('postgres')

    # --- Who may see and edit coupons ---
    as_role('anon')
    denied('anon cannot select coupons', "select count(*) from coupons", contains='permission denied')
    denied('anon cannot price a coupon', "select public.coupon_price('NAVIDAD10', '[]'::jsonb, '{}'::jsonb)", contains='permission denied')
    as_role('authenticated', ana)
    check('a customer sees no coupons', one("select count(*) from coupons")[0], 0)
    denied('a customer cannot insert one', "insert into coupons (code, kind, percent) values ('MIO', 'percent', 90)", contains='row-level security')
    denied('nor price a coupon directly', "select public.coupon_price('NAVIDAD10', '[]'::jsonb, '{}'::jsonb)", contains='permission denied')
    check('nor see the redemptions', one("select count(*) from coupon_redemptions")[0], 0)
    denied('nor record a use', "insert into coupon_redemptions (coupon_id, order_id, discount_cents) values (%s, %s, 1)", (c10, paid), contains='row-level security')
    as_role('authenticated', adm)
    cur.execute("insert into coupons (code, kind, percent) values ('ADMIN10', 'percent', 10)")
    check('admin can', one("select count(*) from coupons where code = 'ADMIN10'")[0], 1)
    check('admin sees the redemptions', one("select count(*) from coupon_redemptions where coupon_id = %s", (once,))[0], 1)
    as_role('postgres')
    denied('a used coupon cannot be deleted', "delete from coupons where id = %s", (once,), contains='coupon_redemptions_coupon_id_fkey')
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
