#!/usr/bin/env python3
# Refunds (Admin › Pedidos › Devolver dinero): what can be refunded, what it
# does to the order, the stock and the invoices (Veri*factu rectifying invoices).
# One transaction, always rolled back.
# Usage: python3 scripts/sql-check-refunds.py [migration.sql ...]
import json, sys, psycopg

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
SET_ROLE = {
    'authenticated': 'set local role authenticated',
    'service_role': 'set local role service_role',
}

def as_role(role, uid=None):
    cur.execute("reset role")
    if role == 'postgres':
        return
    cur.execute(SET_ROLE[role])
    if uid:
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
    'simplifiedPrefix': 'T', 'fullPrefix': 'U', 'rectifyingPrefix': 'V',
    'shippingVatRate': 21, 'verifactuEnabled': False,
})
SET_CONFIG = "update shop_settings set invoice_config = %s::jsonb where id = 1"

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    year = one("select extract(year from timezone('Europe/Madrid', now()))::int")[0]

    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.refund@example.com',now(),'authenticated','authenticated'),(%s,'ana.refund@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.refund@example.com')", (adm,))
    cur.execute(SET_CONFIG, (CONFIG,))

    # A mug with tracked stock, and a card.
    mug, = one("""select p.id from products p join categories c on c.id = p.category_id
                  where c.code = 'mugs' and p.parent_id is null order by p.sku limit 1""")
    card, = one("""select p.id from products p join categories c on c.id = p.category_id
                   where c.code = 'greeting-cards' and p.parent_id is null order by p.sku limit 1""")
    cur.execute("update inventory set inventory_mode = 'tracked', stock_on_hand = 5, stock_reserved = 0, verified_at = now() where product_id = %s", (mug,))

    def paid_order(ref, provider='stripe', customer=None):
        oid, = one("""insert into orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash,
                                          payment_status, customer_email, customer_name, vat_regime, payment_provider,
                                          stripe_payment_intent_id, paypal_capture_id)
                      values (%s, 'es', 2347, 495, 2842, 'test-refund', 'checkout_open', 'cliente@example.com', 'Lucía Prueba',
                              'es_vat', %s, %s, %s) returning id""",
                   (ref, provider, 'pi_test_' + ref if provider == 'stripe' else None, 'CAP' + ref if provider == 'paypal' else None))
        cur.execute("""insert into order_items (order_id, product_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents)
                       values (%s, %s, 'Taza Pug', 'MUG-T', 999, 2, 1998)""", (oid, mug))
        cur.execute("""insert into order_items (order_id, product_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents)
                       values (%s, %s, 'Tarjeta Pug', 'CARD-T', 349, 1, 349)""", (oid, card))
        if customer:
            cur.execute("update orders set invoice_customer = %s::jsonb where id = %s", (json.dumps(customer), oid))
        # Paid: the trigger issues the invoice (full with the customer's tax data).
        cur.execute("update orders set payment_status = 'paid', paid_at = now() where id = %s", (oid,))
        items = dict(cur.execute("select product_sku, id from order_items where order_id = %s", (oid,)).fetchall())
        return oid, items

    def begin(oid, items, shipping=False, restock=False, manual=False, reason='Devolución'):
        cur.execute("select public.admin_begin_refund(%s, %s::jsonb, %s, %s, %s, %s)",
                    (oid, json.dumps([{'order_item_id': str(k), 'quantity': q} for k, q in items]), shipping, restock, reason, manual))
        return cur.fetchone()[0]

    def hash_ok(invoice_number, tipo):
        nif, vat, total, prev, stored, stamp, day = one("""
          select issuer->>'issuerNif', vat_cents, total_cents, coalesce(prev_hash, ''), hash,
                 to_char(timezone('Europe/Madrid', record_generated_at), 'YYYY-MM-DD"T"HH24:MI:SS')
                 || to_char(timezone('Europe/Madrid', record_generated_at) - timezone('UTC', record_generated_at), '+HH24:MI'),
                 to_char(timezone('Europe/Madrid', record_generated_at), 'DD-MM-YYYY')
          from invoices where full_number = %s""", (invoice_number,))
        return one("select public.verifactu_hash(%s, %s, %s, %s, %s, %s, %s, %s)",
                   (nif, invoice_number, day, tipo, vat, total, prev, stamp))[0] == stored

    a, a_items = paid_order('PD-REF-A')
    original = one("select id, full_number, hash, kind from invoices where order_id = %s", (a,))
    check('the paid order has its simplified invoice', original[3], 'simplified')

    # ——— Who can refund ———
    as_role('authenticated', ana)
    denied('a customer cannot refund', "select public.admin_begin_refund(%s, '[]'::jsonb, true, false, '', false)", (a,))
    as_role('authenticated', adm)

    # ——— First refund: one mug, back to stock ———
    started = begin(a, [(a_items['MUG-T'], 1)], restock=True)
    check('the refund is one mug', started['amount_cents'], 999)
    check('Stripe pays it back, to the payment', (started['provider'], started['payment_ref']), ('stripe', 'pi_test_PD-REF-A'))
    denied('one refund at a time per order', "select public.admin_begin_refund(%s, %s::jsonb, false, false, '', false)",
           (a, json.dumps([{'order_item_id': str(a_items['CARD-T']), 'quantity': 1}])), contains='REFUND_IN_PROGRESS')
    cur.execute("select public.admin_complete_refund(%s, 're_test_1')", (started['refund_id'],))
    check('the order is partly refunded', one("select payment_status::text from orders where id = %s", (a,))[0], 'partially_refunded')
    check('the mug is back in stock', one("select stock_on_hand from inventory where product_id = %s", (mug,))[0], 6)
    check('a return_restock movement', one("select count(*) from stock_movements where order_id = %s and reason = 'return_restock'", (a,))[0], 1)

    r1 = one("""select full_number, kind, total_cents, vat_cents, base_cents, rectifies_invoice_id, prev_hash, hash,
                       to_char(timezone('Europe/Madrid', record_generated_at), 'YYYY-MM-DD"T"HH24:MI:SS') , issued_at, issuer->>'issuerNif'
                from invoices i join order_refunds r on r.invoice_id = i.id where r.id = %s""", (started['refund_id'],))
    check('a rectifying invoice in its own series', (r1[0], r1[1]), (f'V{year}-0001', 'rectifying'))
    check('for minus the mug', (r1[2], r1[3] + r1[4]), (-999, -999))
    check('it rectifies the simplified invoice', r1[5], original[0])
    check('it follows the invoice chain', r1[6], original[2])
    check('its hash is a Veri*factu R5 record', hash_ok(r1[0], 'R5'), True)
    check('the customer is told', one("select count(*) from notification_outbox where template_key = 'order_refunded_customer' and payload->>'order_id' = %s", (str(a),))[0], 1)

    # ——— Limits ———
    denied('not more mugs than are left', "select public.admin_begin_refund(%s, %s::jsonb, false, false, '', false)",
           (a, json.dumps([{'order_item_id': str(a_items['MUG-T']), 'quantity': 2}])), contains='REFUND_TOO_MUCH')
    denied('a refund needs something in it', "select public.admin_begin_refund(%s, '[]'::jsonb, false, false, '', false)", (a,), contains='REFUND_EMPTY')

    # ——— A refund that fails leaves the order as it was ———
    failing = begin(a, [(a_items['CARD-T'], 1)])
    cur.execute("select public.admin_fail_refund(%s, 'card_declined')", (failing['refund_id'],))
    check('a failed refund is kept, as failed', one("select status from order_refunds where id = %s", (failing['refund_id'],))[0], 'failed')
    check('and the order stays partly refunded', one("select payment_status::text from orders where id = %s", (a,))[0], 'partially_refunded')

    # ——— The rest: last mug, card and shipping ———
    rest = begin(a, [(a_items['MUG-T'], 1), (a_items['CARD-T'], 1)], shipping=True)
    check('the rest is mug + card + shipping', rest['amount_cents'], 999 + 349 + 495)
    cur.execute("select public.admin_complete_refund(%s, 're_test_2')", (rest['refund_id'],))
    check('the order is refunded', one("select payment_status::text from orders where id = %s", (a,))[0], 'refunded')
    check('the mug was not restocked this time', one("select stock_on_hand from inventory where product_id = %s", (mug,))[0], 6)
    check('everything rectified adds up to the invoice', one("select sum(total_cents) from invoices where rectifies_invoice_id = %s", (original[0],))[0], -2842)
    denied('nothing is left to refund', "select public.admin_begin_refund(%s, '[]'::jsonb, true, false, '', false)", (a,), contains='REFUND_TOO_MUCH')
    as_role('postgres')
    denied('no full invoice in place of a rectified one', """
      insert into invoices (order_id, kind, series, number, full_number, issued_at, operation_date, issuer, customer, lines,
                            breakdown, base_cents, vat_cents, total_cents, vat_regime, exemption_note, locale, prev_hash, hash,
                            record_generated_at, qr_url, replaces_invoice_id)
      select order_id, 'full', 'U', 999, 'U-TEST-999', now(), operation_date, issuer, customer, lines, breakdown, base_cents,
             vat_cents, total_cents, vat_regime, exemption_note, locale, null, 'x', now(), qr_url, id
      from invoices where id = %s""", (original[0],), contains='INVOICE_RECTIFIED')

    # ——— A full invoice is rectified with R1, by PayPal ———
    company = {'taxId': '89890001K', 'name': 'Empresa Prueba', 'address': 'C/ Uno 1', 'postalCode': '28013', 'city': 'Madrid', 'country': 'ES'}
    g, g_items = paid_order('PD-REF-G', provider='paypal', customer=company)
    check('with tax data the order has a full invoice', one("select kind from invoices where order_id = %s", (g,))[0], 'full')
    as_role('authenticated', adm)
    started = begin(g, [(g_items['CARD-T'], 1)])
    check('PayPal pays it back, to the capture', (started['provider'], started['payment_ref']), ('paypal', 'CAPPD-REF-G'))
    cur.execute("select public.admin_complete_refund(%s, 'PPREF1')", (started['refund_id'],))
    as_role('postgres')
    number, customer = one("""select i.full_number, i.customer->>'taxId' from invoices i join order_refunds r on r.invoice_id = i.id
                              where r.id = %s""", (started['refund_id'],))
    check('its hash is a Veri*factu R1 record', hash_ok(number, 'R1'), True)
    check('it keeps the customer', customer, '89890001K')

    # ——— Refunds made in Stripe or PayPal themselves ———
    h, h_items = paid_order('PD-REF-H')
    cur.execute("select public.record_provider_refund('stripe', 'pi_test_PD-REF-H', 're_ext_1', 999)")
    check('a partial refund from Stripe waits to be assigned', cur.fetchone()[0], 'unassigned')
    check('the order shows it as partly refunded', one("select payment_status::text from orders where id = %s", (h,))[0], 'partially_refunded')
    cur.execute("select public.record_provider_refund('stripe', 'pi_test_PD-REF-H', 're_ext_1', 999)")
    check('the same refund twice is recorded once', cur.fetchone()[0], 'known')
    as_role('authenticated', adm)
    denied('registering it needs the same amount', "select public.admin_begin_refund(%s, %s::jsonb, false, false, '', true)",
           (h, json.dumps([{'order_item_id': str(h_items['CARD-T']), 'quantity': 1}])), contains='REFUND_AMOUNT_MISMATCH')
    registered = begin(h, [(h_items['MUG-T'], 1)], manual=True)
    check('registering it completes the Stripe refund', one("select status, provider_refund_id from order_refunds where id = %s", (registered['refund_id'],)),
          ('succeeded', 're_ext_1'))
    check('with its rectifying invoice', one("select invoice_id is not null from order_refunds where id = %s", (registered['refund_id'],))[0], True)
    as_role('postgres')
    cur.execute("select public.record_provider_refund('stripe', 'pi_test_PD-REF-H', 're_ext_2', 349 + 999 + 495)")
    check('a refund of all that is left is assigned by itself', cur.fetchone()[0], 'assigned')
    check('and the order is refunded', one("select payment_status::text from orders where id = %s", (h,))[0], 'refunded')

    # A refund we started, confirmed by the webhook before we completed it.
    k, k_items = paid_order('PD-REF-K')
    as_role('authenticated', adm)
    started = begin(k, [(k_items['CARD-T'], 1)])
    as_role('postgres')
    cur.execute("update order_refunds set provider_refund_id = 're_k' where id = %s", (started['refund_id'],))
    cur.execute("select public.record_provider_refund('stripe', 'pi_test_PD-REF-K', 're_k', 349)")
    check('the webhook completes a refund left pending', cur.fetchone()[0], 'completed')
    check('which is now done', one("select status from order_refunds where id = %s", (started['refund_id'],))[0], 'succeeded')

    # ——— Without tax data the rectifying invoice waits ———
    cur.execute("update shop_settings set invoice_config = invoice_config - 'issuerNif' where id = 1")
    m, m_items = paid_order('PD-REF-M')
    check('no invoice without tax data', one("select count(*) from invoices where order_id = %s", (m,))[0], 0)
    as_role('authenticated', adm)
    started = begin(m, [(m_items['CARD-T'], 1)])
    cur.execute("select public.admin_complete_refund(%s, 're_m')", (started['refund_id'],))
    check('the refund still happens', one("select status, invoice_id from order_refunds where id = %s", (started['refund_id'],)), ('succeeded', None))
    as_role('postgres')
    cur.execute(SET_CONFIG, (CONFIG,))
    as_role('authenticated', adm)
    cur.execute("select public.admin_issue_pending_invoices()")
    kinds = cur.execute("select kind from invoices where order_id = %s order by record_generated_at", (m,)).fetchall()
    check('later: the invoice, then its rectifying invoice', [r[0] for r in kinds], ['simplified', 'rectifying'])
    check('linked to the refund', one("select invoice_id is not null from order_refunds where id = %s", (started['refund_id'],))[0], True)

    # ——— Admin can read refunds; customers cannot ———
    check('the admin sees the refunds', one("select count(*) > 0 from order_refunds")[0], True)
    as_role('authenticated', ana)
    check('a customer sees none', one("select count(*) from order_refunds")[0], 0)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
