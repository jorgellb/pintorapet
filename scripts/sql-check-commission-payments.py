#!/usr/bin/env python3
# Paying for a commission (encargos): the link, the quote (VAT, shipping by zone
# and weight), reserving without stock, payment by card (as Stripe's webhook
# applies it) and by Bizum, the commission accepted, its invoice; and a shop
# order still reserving and consuming stock. One transaction, always rolled back.
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-commission-payments.py
import hashlib, json, sys
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
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Boss','boss.cpay@example.com',true,now())", (adm,))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.cpay@example.com')", (adm,))
    cur.execute("insert into shop_settings (id) values (1) on conflict (id) do nothing")
    cur.execute("update shop_settings set sales_enabled = true, payments_enabled = true, invoice_config = %s::jsonb where id = 1", (CONFIG,))
    h = lambda t: hashlib.sha256(t.encode()).hexdigest()

    def request(ref, token, cents=9000, status='quoted', until="now() + interval '30 days'", rate=None):
        cid, = one(f"""insert into commission_requests (reference, locale, contact_name, contact_email, message, status,
                         quote_cents, quote_vat_rate, quote_weight_grams, pay_token_hash, quote_until)
                      values (%s, 'es', 'Ana', 'ana.cpay@example.com', 'Mi perro', %s, %s, %s, 450, %s, {until}) returning id""",
                   (ref, status, cents, rate, h(token)))
        return cid

    c1 = request('CR-PAGO000001', 'token-uno-0123456789')
    denied('a wrong key opens nothing', "select public.commission_for_payment('CR-PAGO000001', %s)", (h('otra-clave'),), contains='COMMISSION_LINK_INVALID')
    request('CR-PAGO000002', 'token-dos-0123456789', status='reviewing')
    denied('nor a request not quoted yet', "select public.commission_for_payment('CR-PAGO000002', %s)", (h('token-dos-0123456789'),), contains='COMMISSION_NOT_PAYABLE')
    request('CR-PAGO000003', 'token-tres-0123456789', until="now() - interval '1 day'")
    denied('nor an expired quote', "select public.commission_for_payment('CR-PAGO000003', %s)", (h('token-tres-0123456789'),), contains='COMMISSION_NOT_PAYABLE')

    owner = 'owner-hash-commission-01'
    quote = lambda ref, tok, country, cp: one("select id, subtotal_cents, shipping_cents, total_cents, vat_regime, shipping_zone_name, lines->0->>'vat_rate', lines->0->>'sku' from public.create_commission_quote(%s, %s, %s, %s, %s)", (ref, h(tok), owner, country, cp))
    q = quote('CR-PAGO000001', 'token-uno-0123456789', 'ES', '28013')
    check('the Peninsula: free shipping over 60 €, Spanish VAT', q[1:], (9000, 0, 9000, 'es_vat', 'Península', '21', 'CR-PAGO000001'))
    qc = quote('CR-PAGO000001', 'token-uno-0123456789', 'ES', '38001')
    check('the Canaries: no Spanish VAT, shipping charged', (qc[1], qc[4], qc[2] > 0), (7438, 'no_vat', True))
    denied('no postcode in Spain', "select public.create_commission_quote('CR-PAGO000001', %s, %s, 'ES', '')", (h('token-uno-0123456789'), owner), contains='SHIPPING_POSTAL_CODE_REQUIRED')

    # ——— Card: reserved, then paid as Stripe's webhook does it ———
    r = one("select public.reserve_checkout('a1777777-7777-4777-8777-000000000001', %s, %s, 'hash-c1', 'checkout:c1')", (owner, q[0]))[0]
    o = one("select commission_request_id = %s, total_cents, (select count(*) from order_items where order_id = o.id and product_id is null), (select count(*) from stock_reservations where checkout_attempt_id = 'a1777777-7777-4777-8777-000000000001') from orders o where id = %s", (c1, r['order_id']))
    check('reserving makes its order: the portrait, no stock', o, (True, 9000, 1, 0))
    res = one("select public.apply_payment(%s, 'evt_c1', 'cs_c1', 'pi_c1', 9000, 'EUR', 'ana.cpay@example.com', 'Ana', null)", (r['order_id'],))[0]
    check('paid by card: paid, not sent to review', (res['status'], one("select payment_status::text from orders where id = %s", (r['order_id'],))[0]), ('paid', 'paid'))
    check('the commission is accepted and points at it', one("select status::text, paid_order_id = %s, pay_token_hash is null from commission_requests where id = %s", (r['order_id'], c1)), ('accepted', True, True))
    check('its invoice is issued, with the portrait line', one("select kind, (lines->0->>'description') like 'Retrato%%', (lines->0->>'vatRate')::numeric from invoices where order_id = %s", (r['order_id'],)), ('simplified', True, 21))
    denied('the link is spent once paid', "select public.create_commission_quote('CR-PAGO000001', %s, %s, 'ES', '28013')", (h('token-uno-0123456789'), owner), contains='COMMISSION_LINK_INVALID')

    # ——— VAT from the request (10 % once confirmed) ———
    request('CR-PAGO000004', 'token-cuatro-0123456789', cents=11000, rate=10)
    q4 = quote('CR-PAGO000004', 'token-cuatro-0123456789', 'ES', '46001')
    r4 = one("select public.reserve_checkout('b4777777-7777-4777-8777-000000000004', %s, %s, 'hash-c4', 'checkout:c4')", (owner, q4[0]))[0]
    one("select public.apply_payment(%s, 'evt_c4', 'cs_c4', 'pi_c4', 11000, 'EUR', null, null, null)", (r4['order_id'],))
    check('a quote at 10 % is invoiced at 10 %', one("select (lines->0->>'vatRate')::numeric from invoices where order_id = %s", (r4['order_id'],))[0], 10)

    # ——— Bizum: waits, then marked paid by hand ———
    c5 = request('CR-PAGO000005', 'token-cinco-0123456789')
    q5 = quote('CR-PAGO000005', 'token-cinco-0123456789', 'ES', '46001')
    body5 = json.dumps({'reference': 'CR-PAGO000005', 'token_hash': h('token-cinco-0123456789'), 'method': 'bizum', 'quote_id': str(q5[0]),
                        'customer': {'name': 'Ana', 'email': 'ana.cpay@example.com', 'phone': '600111222'},
                        'address': {'name': 'Ana', 'line1': 'Calle Paz 1', 'postal_code': '46001', 'city': 'Valencia', 'country': 'ES'}})
    m = one("select public.create_commission_manual_order(%s::jsonb)", (body5,))[0]
    again = one("select public.create_commission_manual_order(%s::jsonb)", (body5,))[0]
    check('a Bizum order waits; a second click returns the same', (one("select payment_status::text, payment_provider from orders where id = %s", (m['order_id'],)), again['order_id'] == m['order_id']), (('awaiting_transfer', 'bizum'), True))
    as_role('authenticated', adm)
    cur.execute("select public.admin_mark_order_paid(%s)", (m['order_id'],))
    as_role('postgres')
    check('marked paid: the commission is accepted', one("select status::text from commission_requests where id = %s", (c5,))[0], 'accepted')

    # ——— Guards (review of 20261126000005) ———
    c6 = request('CR-PAGO000006', 'token-seis-0123456789')
    old = quote('CR-PAGO000006', 'token-seis-0123456789', 'ES', '46001')
    # Meili quotes again, higher, with a new link: what was worked out before is gone.
    cur.execute("update commission_requests set quote_cents = 15000, pay_token_hash = %s where id = %s", (h('token-seis-nuevo-0123456789'), c6))
    denied('an old quote cannot be reserved after quoting again', "select public.reserve_checkout('e6777777-7777-4777-8777-000000000006', %s, %s, 'hash-c6', 'checkout:c6')", (owner, old[0]), contains='PRICE_CHANGED')
    old_manual = json.dumps({'reference': 'CR-PAGO000006', 'token_hash': h('token-seis-nuevo-0123456789'), 'method': 'bizum', 'quote_id': str(old[0]),
                             'customer': {'name': 'Ana', 'email': 'ana.cpay@example.com', 'phone': '600111222'}, 'address': {'line1': 'C/ 1'}})
    denied('nor paid by Bizum at the old price', "select public.create_commission_manual_order(%s::jsonb)", (old_manual,), contains='PRICE_CHANGED')
    new = quote('CR-PAGO000006', 'token-seis-nuevo-0123456789', 'ES', '46001')
    check('the new quote has the new price', new[1], 15000)

    # Two tabs, two payments: the second goes to review.
    tab1 = one("select public.reserve_checkout('f1777777-7777-4777-8777-000000000071', %s, %s, 'hash-t1', 'checkout:t1')", (owner, new[0]))[0]
    new2 = quote('CR-PAGO000006', 'token-seis-nuevo-0123456789', 'ES', '46001')
    tab2 = one("select public.reserve_checkout('f2777777-7777-4777-8777-000000000072', %s, %s, 'hash-t2', 'checkout:t2')", (owner, new2[0]))[0]
    one("select public.apply_payment(%s, 'evt_t1', 'cs_t1', 'pi_t1', 15000, 'EUR', null, null, null)", (tab1['order_id'],))
    second = one("select public.apply_payment(%s, 'evt_t2', 'cs_t2', 'pi_t2', 15000, 'EUR', null, null, null)", (tab2['order_id'],))[0]
    check('a second payment of the same commission goes to review', (second['status'], second.get('reason')), ('review', 'COMMISSION_ALREADY_PAID'))
    check('and the commission keeps its first order', one("select paid_order_id = %s from commission_requests where id = %s", (tab1['order_id'], c6))[0], True)

    # Bizum while the shop is closed: refused, as the checkout is.
    c7 = request('CR-PAGO000007', 'token-siete-0123456789')
    q7 = quote('CR-PAGO000007', 'token-siete-0123456789', 'ES', '46001')
    cur.execute("update shop_settings set sales_enabled = false where id = 1")
    closed = json.dumps({'reference': 'CR-PAGO000007', 'token_hash': h('token-siete-0123456789'), 'method': 'bizum', 'quote_id': str(q7[0]),
                         'customer': {'name': 'Ana', 'email': 'ana.cpay@example.com', 'phone': '600111222'}, 'address': {'line1': 'C/ 1'}})
    denied('no Bizum order while sales are closed', "select public.create_commission_manual_order(%s::jsonb)", (closed,), contains='SALES_DISABLED')
    cur.execute("update shop_settings set sales_enabled = true where id = 1")

    # Marked paid by hand when it was paid already: refused.
    q8 = quote('CR-PAGO000007', 'token-siete-0123456789', 'ES', '46001')
    manual8 = one("select public.create_commission_manual_order(%s::jsonb)", (json.dumps({**json.loads(closed), 'quote_id': str(q8[0])}),))[0]
    q9 = quote('CR-PAGO000007', 'token-siete-0123456789', 'ES', '46001')
    card9 = one("select public.reserve_checkout('a9777777-7777-4777-8777-000000000079', %s, %s, 'hash-c9', 'checkout:c9')", (owner, q9[0]))[0]
    one("select public.apply_payment(%s, 'evt_c9', 'cs_c9', 'pi_c9', %s, 'EUR', null, null, null)", (card9['order_id'], q9[3]))
    as_role('authenticated', adm)
    denied('a Bizum order cannot be marked paid once the card paid it', "select public.admin_mark_order_paid(%s)", (manual8['order_id'],), contains='COMMISSION_ALREADY_PAID')
    as_role('postgres')

    # ——— The shop is unchanged: a product still reserves and consumes its stock ———
    cat, = one("select id from categories order by sort_order limit 1")
    mug, = one("insert into products (sku, category_id, motif, status, price_cents, editorial_order, sale_enabled, weight_grams) values ('T-CPAY', %s, 'Pug', 'published', 999, 99004, true, 380) returning id", (cat,))
    cur.execute("insert into product_translations (product_id, locale, slug, title) values (%s,'es','taza-cpay','Taza Pug'),(%s,'en','mug-cpay','Pug Mug')", (mug, mug))
    cur.execute("insert into inventory (product_id, inventory_mode, stock_on_hand, verified_at) values (%s,'tracked',5,now()) on conflict (product_id) do update set inventory_mode='tracked', stock_on_hand=5, stock_reserved=0, verified_at=now()", (mug,))
    sq, = one("select id from public.create_checkout_quote(%s, 'es', array[row(%s::uuid, 2)::public.cart_line_input], 'ES', '46001')", (owner, mug))
    sr = one("select public.reserve_checkout('c9777777-7777-4777-8777-000000000009', %s, %s, 'hash-s', 'checkout:s')", (owner, sq))[0]
    total, = one("select total_cents from orders where id = %s", (sr['order_id'],))
    check('a shop order reserves its stock', one("select stock_reserved from inventory where product_id = %s", (mug,))[0], 2)
    one("select public.apply_payment(%s, 'evt_s', 'cs_s', 'pi_s', %s, 'EUR', null, null, null)", (sr['order_id'], total))
    check('and paying consumes it', (one("select payment_status::text from orders where id = %s", (sr['order_id'],))[0], one("select stock_on_hand, stock_reserved from inventory where product_id = %s", (mug,))), ('paid', (3, 0)))
    sq2, = one("select id from public.create_checkout_quote(%s, 'es', array[row(%s::uuid, 1)::public.cart_line_input], 'ES', '46001')", (owner, mug))
    sr2 = one("select public.reserve_checkout('d8777777-7777-4777-8777-000000000008', %s, %s, 'hash-s2', 'checkout:s2')", (owner, sq2))[0]
    cur.execute("update stock_reservations set status = 'released' where checkout_attempt_id = 'd8777777-7777-4777-8777-000000000008'")
    total2, = one("select total_cents from orders where id = %s", (sr2['order_id'],))
    res2 = one("select public.apply_payment(%s, 'evt_s2', 'cs_s2', 'pi_s2', %s, 'EUR', null, null, null)", (sr2['order_id'], total2))[0]
    check('a shop order whose reservation lapsed still goes to review', (res2['status'], res2.get('reason')), ('review', 'PAID_WITHOUT_RESERVATION'))
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
