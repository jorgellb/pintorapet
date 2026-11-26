#!/usr/bin/env python3
# Guest customers (Admin › Clientes, people who ordered without an account):
# their key, the record, editing the contact on every order, and anonymizing
# (what is cleared, what the invoice keeps, what blocks it, who may call it).
# One transaction, always rolled back. Runs on the local Docker PostgreSQL.
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-guest-customers.py
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
SET_ROLE = {'authenticated': 'set local role authenticated', 'anon': 'set local role anon',
            'service_role': 'set local role service_role'}

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

def key(email):
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()

try:
    # ——— The accounts and the orders ———
    acct = '99999999-cccc-4ccc-8ccc-cccccccccccc'
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Cuenta','Cuenta.Guest@Example.com',true,now())", (acct,))

    def order(ref, email, payment='paid', fulfillment='shipped', total=1000, age_days=0, name='Ana García', address=None, gift=False, customer=None):
        address = address if address is not None else {
            'name': name, 'line1': 'Calle Mayor 1', 'city': 'Madrid', 'state': 'Madrid',
            'postal_code': '28001', 'country': 'ES', 'phone': '600000000'}
        return one("""insert into orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash,
                        payment_status, fulfillment_status, payment_provider, customer_email, customer_name, shipping_address,
                        is_gift, gift_message, invoice_customer, customer_id, created_at)
                      values (%s, 'es', %s, 0, %s, 'x', %s, %s, 'stripe', %s, %s, %s, %s, %s, %s, %s, now() - make_interval(days => %s))
                      returning id""",
                   (ref, total, total, payment, fulfillment, email, name, json.dumps(address), gift,
                    'Con cariño' if gift else None, json.dumps({'taxId': 'X1234567L', 'name': name}), customer, age_days))[0]

    # Ana writes her email three ways; she has a shipped paid order and one awaiting a transfer.
    a1 = order('PD-GST-A1', 'Ana@X.test ', age_days=5, gift=True)
    a2 = order('PD-GST-A2', 'ana@x.test', payment='awaiting_transfer', fulfillment='unfulfilled', total=700, age_days=1,
               address={'name': 'Regalo para Luis', 'line1': 'Calle Sol 2', 'city': 'Sevilla', 'postal_code': '41001', 'country': 'ES', 'phone': '600000000'})
    # Bea: a shipped paid order and one still unpaid (a started checkout).
    b1 = order('PD-GST-B1', 'bea@x.test', age_days=9, name='Bea Ruiz', total=2500)
    b2 = order('PD-GST-B2', 'BEA@x.test', payment='pending_session', fulfillment='unfulfilled', total=300, age_days=2, name='Bea Ruiz')
    # Dani: never touched; orders linked to an account are not guests.
    d1 = order('PD-GST-D1', 'dani@x.test', name='Dani Soto', total=900)
    c1 = order('PD-GST-C1', 'cuenta.guest@example.com', name='Cuenta', customer=acct)

    # A full invoice on Ana's shipped order, and a simplified one on Dani's.
    def invoice(order_id, kind, number):
        cur.execute("""insert into invoices (order_id, kind, series, number, full_number, operation_date, issuer, customer, lines,
                         breakdown, base_cents, vat_cents, total_cents, vat_regime, locale, hash, record_generated_at, qr_url)
                       values (%s, %s, 'T', %s, 'T-GST-' || %s, current_date, '{"name":"Taller"}', %s, '[]', '[]', 826, 174, 1000,
                         'es', 'es', 'h', now(), 'https://example.test/qr')""",
                    (order_id, kind, number, number, json.dumps({'taxId': 'X1234567L', 'name': 'Ana García'}) if kind == 'full' else None))
    invoice(a1, 'full', 9001)
    invoice(d1, 'simplified', 9002)

    # Everything that holds her email besides the orders. Each attempt has its own quote, with the invoice
    # details typed at the checkout (tax id, name, address): kept only where the order has its full invoice.
    def quote(tag):
        cur.execute("""insert into checkout_quotes (cart_owner_hash, locale, lines, price_fingerprint, config_version, subtotal_cents, total_cents, expires_at, shipping_country, invoice_customer)
                       values ('x', 'es', '[]', %s, 1, 1000, 1000, now() + interval '1 hour', 'ES', %s) returning id""",
                    ('fp-' + tag, json.dumps({'taxId': 'X1234567L', 'name': 'Typed ' + tag, 'address': 'Calle ' + tag})))
        return cur.fetchone()[0]
    q_a, q_b, q_d = quote('a'), quote('b'), quote('d')
    cur.execute("""insert into checkout_attempts (id, cart_owner_hash, quote_id, request_hash, order_id, status, stripe_payload, stripe_idempotency_key)
                   values (gen_random_uuid(), 'x', %s, 'r1', %s, 'paid', %s, 'idem-a1')""",
                (q_a, a1, json.dumps({'customer_details': {'email': 'ana@x.test', 'name': 'Ana García'}})))
    cur.execute("""insert into checkout_attempts (id, cart_owner_hash, quote_id, request_hash, order_id, status, stripe_payload, stripe_idempotency_key)
                   values (gen_random_uuid(), 'x', %s, 'r3', %s, 'paid', %s, 'idem-b1')""",
                (q_b, b1, json.dumps({'customer_details': {'email': 'bea@x.test'}})))
    cur.execute("""insert into checkout_attempts (id, cart_owner_hash, quote_id, request_hash, order_id, status, stripe_payload, stripe_idempotency_key)
                   values (gen_random_uuid(), 'x', %s, 'r2', %s, 'paid', %s, 'idem-d1')""",
                (q_d, d1, json.dumps({'customer_details': {'email': 'dani@x.test'}})))
    invoice(b1, 'simplified', 9003)
    # (Attaching an attempt copies the quote's invoice customer, none here, onto the order.)
    cur.execute("update orders set invoice_customer = %s where id = %s", (json.dumps({'taxId': 'X1234567L', 'name': 'Ana García'}), a1))
    # Outbox: mail about her orders sent to the email she had then (and to the shop), mail to the email
    # she has now, and rows that are not hers: another order sent to her old email, one about nothing.
    outbox = [
        ('gst-a-1', 'ana@x.test', {'order_id': str(a1)}), ('gst-a-2', 'Ana@X.test', {'order_id': str(a2)}),
        ('gst-a-3', 'admin@shop.test', {'order_id': str(b1)}),
        ('gst-b-1', 'bea@x.test', {}), ('gst-b-2', ' BEA@x.test', {'reference': 'PD-OTHER'}),
        ('gst-a-4', 'ana@x.test', {'order_id': str(d1)}), ('gst-a-5', 'ana@x.test', {}),
        ('gst-d-1', 'dani@x.test', {'order_id': str(d1)}),
        # Sent to Bea's email but about an order that stays (an account order that shares the email, say).
        ('gst-b-3', 'bea@x.test', {'order_id': str(d1)}),
    ]
    for dedupe, recipient, payload in outbox:
        cur.execute("insert into notification_outbox (dedupe_key, recipient, locale, template_key, payload) values (%s, %s, 'es', 'order_paid', %s)",
                    (dedupe, recipient, json.dumps(payload)))
    cur.execute("insert into coupons (code, kind, percent) values ('GSTCHECK', 'percent', 10) returning id")
    coupon = cur.fetchone()[0]
    cur.execute("insert into coupon_redemptions (coupon_id, order_id, email, payer_email, discount_cents) values (%s, %s, 'ana@x.test', 'payer.ana@x.test', 100)", (coupon, a1))
    cur.execute("insert into coupon_redemptions (coupon_id, order_id, email, discount_cents) values (%s, %s, 'dani@x.test', 100)", (coupon, d1))
    cur.execute("""insert into reviews (source, kind, author_name, body, locale, consent_at, order_id, status, verified)
                   values ('customer', 'general', 'Ana G.', 'Preciosa', 'es', now(), %s, 'published', true) returning id""", (a1,))
    review_a = cur.fetchone()[0]
    cur.execute("""insert into reviews (source, kind, author_name, body, locale, consent_at, order_id, status, verified)
                   values ('customer', 'general', 'Dani S.', 'Genial', 'es', now(), %s, 'published', true) returning id""", (d1,))
    review_d = cur.fetchone()[0]
    # The notice to the shop about each review: no order in it, only the review (name, city, excerpt).
    for who, rid in (('Ana G.', review_a), ('Dani S.', review_d)):
        cur.execute("insert into notification_outbox (dedupe_key, recipient, locale, template_key, payload) values (%s, 'admin@shop.test', 'es', 'review_admin', %s)",
                    (f'review_admin:{rid}', json.dumps({'review_id': str(rid), 'name': who, 'city': 'Madrid', 'excerpt': 'Preciosa'})))
    cur.execute("insert into contact_messages (locale, contact_name, contact_email, message) values ('es', 'Ana', 'ANA@x.test', 'Hola')")
    cur.execute("insert into commission_requests (reference, locale, contact_name, contact_email, message) values ('PD-GST-CR1', 'es', 'Ana', 'ana@x.test', 'Un retrato'), ('PD-GST-CR2', 'es', 'Ana', 'otra@x.test', 'Otro')")

    ka, kb, kd = key('ana@x.test'), key('bea@x.test'), key('dani@x.test')
    snapshot = lambda oid: one("select customer_name, customer_email, shipping_address, gift_message, is_gift, invoice_customer from orders where id = %s", (oid,))

    as_role('service_role')

    # ——— The key ———
    check('guest_key is the sha256 of the lowered, trimmed email', one("select guest_key('  Ana@X.test ')")[0], ka)
    check('case and spaces are one guest', one("select count(*) from orders where customer_id is null and guest_key(customer_email) = %s", (ka,))[0], 2)
    check('and the same key over null is null', one("select guest_key(null)")[0], None)

    # ——— The record ———
    rec = one("select admin_guest_customer(%s)", (ka,))[0]
    check('admin_guest_customer: key and email', (rec['key'], rec['email']), (ka, 'ana@x.test'))
    check('admin_guest_customer lists orders and spent',
          ([o['reference'] for o in rec['orders']], rec['spent_cents']), (['PD-GST-A2', 'PD-GST-A1'], 1000))
    check('an order has id, dates, statuses and total',
          sorted(rec['orders'][1]), ['created_at', 'fulfillment_status', 'id', 'payment_status', 'reference', 'total_cents'])
    check('name and phone come from the latest order', (rec['full_name'], rec['phone']), ('Ana García', '600000000'))
    check('contact messages and commission requests, by the same key', (rec['contact_messages'], rec['commission_requests']), (1, 1))
    check('an unknown key is null', one("select admin_guest_customer(%s)", (key('nadie@x.test'),))[0], None)
    check('an account\'s orders are not a guest', one("select admin_guest_customer(%s)", (key('cuenta.guest@example.com'),))[0], None)
    check('an unfinished checkout is not listed (Bea)', [o['reference'] for o in one("select admin_guest_customer(%s)", (kb,))[0]['orders']], ['PD-GST-B1'])

    # ——— Editing ———
    denied('a name is required', "select admin_guest_update(%s, '  ', 'ana@x.test', '')", (ka,), contains='GUEST_INVALID_NAME')
    denied('a name over 120 characters is refused', "select admin_guest_update(%s, %s, 'ana@x.test', '')", (ka, 'n' * 121), contains='GUEST_INVALID_NAME')
    denied('an email needs its shape', "select admin_guest_update(%s, 'Ana', 'ana-sin-arroba', '')", (ka,), contains='GUEST_INVALID_EMAIL')
    denied('a phone over 32 characters is refused', "select admin_guest_update(%s, 'Ana', 'ana@x.test', %s)", (ka, '6' * 33), contains='GUEST_INVALID_PHONE')
    denied('an unknown guest is refused', "select admin_guest_update(%s, 'Ana', 'ana@x.test', '')", (key('nadie@x.test'),), contains='GUEST_NOT_FOUND')
    denied('edit to an account\'s email is refused', "select admin_guest_update(%s, 'Ana', ' CUENTA.guest@example.com ', '')", (ka,), contains='GUEST_EMAIL_IS_ACCOUNT')

    res = one("select admin_guest_update(%s, ' Ana María ', ' Ana.Nueva@X.test ', ' 611 222 333 ')", (ka,))[0]
    kn = key('ana.nueva@x.test')
    check('edit answers with the new key, no merge, and the orders touched', res, {'key': kn, 'merged': False, 'orders': 2, 'phone_skipped': 0})
    check('edit renames, re-emails and re-phones all guest orders',
          [one("select customer_name, customer_email, shipping_address->>'phone' from orders where id = %s", (o,)) for o in (a1, a2)],
          [('Ana María', 'ana.nueva@x.test', '611 222 333')] * 2)
    check('the shipping name follows when it was the customer\'s', one("select shipping_address->>'name' from orders where id = %s", (a1,))[0], 'Ana María')
    check('and stays when it was someone else\'s', one("select shipping_address->>'name' from orders where id = %s", (a2,))[0], 'Regalo para Luis')
    check('the rest of the address is untouched', one("select shipping_address - 'name' - 'phone' from orders where id = %s", (a1,))[0],
          {'line1': 'Calle Mayor 1', 'city': 'Madrid', 'state': 'Madrid', 'postal_code': '28001', 'country': 'ES'})
    check('other guests are untouched', snapshot(d1)[:2], ('Dani Soto', 'dani@x.test'))
    check('an account\'s order is untouched', snapshot(c1)[:2], ('Cuenta', 'cuenta.guest@example.com'))
    check('the old key now has no orders', one("select admin_guest_customer(%s)", (ka,))[0], None)
    cur.execute("select admin_guest_update(%s, 'Ana María', 'ana.nueva@x.test', '')", (kn,))
    check('an empty phone takes the phone off', one("select shipping_address ? 'phone' from orders where id = %s", (a1,))[0], False)

    # ——— Merging: Ana takes Bea's email ———
    res = one("select admin_guest_update(%s, 'Bea Ruiz', 'BEA@x.test', '699 000 111')", (kn,))[0]
    check('edit to another guest\'s email merges', res, {'key': kb, 'merged': True, 'orders': 2, 'phone_skipped': 0})
    check('one record of four orders', one("select count(*) from orders where customer_id is null and guest_key(customer_email) = %s", (kb,))[0], 4)
    check('the invoice did not move', one("select customer from invoices where order_id = %s", (a1,))[0], {'taxId': 'X1234567L', 'name': 'Ana García'})

    # ——— Anonymizing ———
    check('guest_due_orders names the pending ones', one("select guest_due_orders(%s)", ([a1, a2, b1, b2],))[0], ['PD-GST-A2', 'PD-GST-B2'])
    check('shipped and paid is not due; nothing given is nothing due', (one("select guest_due_orders(%s)", ([a1, b1],))[0], one("select guest_due_orders('{}')")[0]), ([], []))
    # (reference, payment, fulfillment, due, invoiced, charged). An order that was charged needs its invoice too.
    numbers = iter(range(9100, 9200))
    for ref, payment, fulfillment, due, invoiced, charged in (
            ('PD-GST-S1', 'pending_session', 'unfulfilled', True, False, False), ('PD-GST-S2', 'checkout_open', 'unfulfilled', True, False, False),
            ('PD-GST-S3', 'processing', 'unfulfilled', True, False, False), ('PD-GST-S4', 'awaiting_transfer', 'unfulfilled', True, False, False),
            ('PD-GST-S5', 'review', 'unfulfilled', True, False, False), ('PD-GST-S6', 'paid', 'unfulfilled', True, True, False),
            ('PD-GST-S7', 'paid', 'preparing', True, True, False), ('PD-GST-S8', 'partially_refunded', 'preparing', True, True, False),
            ('PD-GST-S9', 'paid', 'shipped', False, True, False), ('PD-GST-T1', 'paid', 'in_transit', False, True, False),
            ('PD-GST-T2', 'paid', 'out_for_delivery', False, True, False), ('PD-GST-T3', 'paid', 'completed', False, True, False),
            ('PD-GST-T4', 'partially_refunded', 'shipped', False, True, False), ('PD-GST-T5', 'refunded', 'unfulfilled', False, False, False),
            ('PD-GST-T6', 'cancelled', 'unfulfilled', False, False, False), ('PD-GST-T7', 'expired', 'unfulfilled', False, False, False),
            # Charged and shipped, but no invoice issued yet (issuing it failed): a later pending-invoice run would
            # issue a simplified one to someone who gave a tax id, so these are not ready either.
            ('PD-GST-U1', 'paid', 'shipped', True, False, False), ('PD-GST-U2', 'partially_refunded', 'shipped', True, False, False),
            ('PD-GST-U3', 'refunded', 'unfulfilled', True, False, True),
            ('PD-GST-U4', 'refunded', 'unfulfilled', False, False, False),  # refunded without ever being charged
            ('PD-GST-U5', 'refunded', 'unfulfilled', False, True, True)):
        probe = order(ref, 'probe@x.test', payment=payment, fulfillment=fulfillment)
        if charged:
            cur.execute("update orders set paid_at = now() where id = %s", (probe,))
        if invoiced:
            invoice(probe, 'simplified', next(numbers))
        check(f'{payment} + {fulfillment}{" + invoice" if invoiced else ""}{" (charged)" if charged else ""} is {"" if due else "not "}due',
              one("select guest_due_orders(%s)", ([probe],))[0], [ref] if due else [])
    # Invoices cannot be deleted, so the probes just stop being anybody's.
    cur.execute("update orders set customer_email = null where customer_email = 'probe@x.test'")

    ids = [a1, a2, b1, b2]
    denied('pending order blocks anonymizing (the message has the references)', "select admin_guest_anonymize(%s)", (kb,), contains='CUSTOMER_HAS_DUE_ORDERS: PD-GST-A2')
    denied('anonymize_orders refuses by itself too', "select anonymize_orders(%s, 'bea@x.test')", (ids,), contains='CUSTOMER_HAS_DUE_ORDERS')
    check('and nothing changed', snapshot(b1)[:2], ('Bea Ruiz', 'bea@x.test'))
    check('(and the review is still there)', one("select count(*) from reviews where id = %s", (review_a,))[0], 1)

    # With the transfer cancelled, what is left is Bea's checkout that never ended: a reason of its own, with its own text.
    cur.execute("update orders set payment_status = 'cancelled' where id = %s", (a2,))
    denied('an unfinished checkout blocks it, and the message says to delete it', "select admin_guest_anonymize(%s)", (kb,), contains='CUSTOMER_HAS_UNFINISHED_ORDERS: PD-GST-B2')
    cur.execute("update orders set payment_status = 'cancelled' where id = %s", (b2,))
    invoice_before = one("select to_jsonb(i)::text from invoices i where order_id = %s", (a1,))[0]
    simple_before = one("select to_jsonb(i)::text from invoices i where order_id = %s", (d1,))[0]
    d1_before = snapshot(d1)

    res = one("select admin_guest_anonymize(%s)", (kb,))[0]
    check('anonymize answers with the orders and the review ids', (res['orders'], res['review_ids']), (4, [str(review_a)]))
    check('anonymize clears name/email/address/gift, keeps country+postal',
          snapshot(a1)[:5], ('Cliente borrado', None, {'country': 'ES', 'postal_code': '28001'}, None, False))
    check('(on the order sent elsewhere too)', snapshot(a2)[:5], ('Cliente borrado', None, {'country': 'ES', 'postal_code': '41001'}, None, False))
    check('an order without a full invoice loses invoice_customer', (snapshot(a2)[5], snapshot(b1)[5], snapshot(b2)[5]), (None, None, None))
    check('an invoiced order keeps its invoice data and invoice row',
          (snapshot(a1)[5], one("select to_jsonb(i)::text from invoices i where order_id = %s", (a1,))[0]),
          ({'taxId': 'X1234567L', 'name': 'Ana García'}, invoice_before))
    check('stripe_payload nulled', one("select stripe_payload from checkout_attempts where order_id = %s", (a1,))[0], None)
    check('(and the other customer\'s kept)', one("select stripe_payload is not null from checkout_attempts where order_id = %s", (d1,))[0], True)
    check('outbox rows for the email about no order are deleted', one("select count(*) from notification_outbox where lower(btrim(recipient)) = 'bea@x.test' and payload->>'order_id' is null")[0], 0)
    check('rows about these orders go, whatever the recipient (an old email, the shop)',
          one("select count(*) from notification_outbox where dedupe_key in ('gst-a-1', 'gst-a-2', 'gst-a-3')")[0], 0)
    cur.execute("select dedupe_key from notification_outbox where dedupe_key like 'gst-%' order by 1")
    check('rows of unrelated orders and recipients stay, even to the same old email', [r[0] for r in cur.fetchall()], ['gst-a-4', 'gst-a-5', 'gst-b-3', 'gst-d-1'])
    check('(a row to the same email about an order that stays is kept)', one("select count(*) from notification_outbox where dedupe_key = 'gst-b-3'")[0], 1)
    check('(Dani\'s outbox row is kept)', one("select count(*) from notification_outbox where recipient = 'dani@x.test'")[0], 1)
    check('coupon redemption emails nulled', one("select email, payer_email from coupon_redemptions where order_id = %s", (a1,)), (None, None))
    check('(Dani\'s kept)', one("select email from coupon_redemptions where order_id = %s", (d1,))[0], 'dani@x.test')
    check('the shop\'s notice about the review (name, city, excerpt) is deleted', one("select count(*) from notification_outbox where template_key = 'review_admin' and payload->>'review_id' = %s", (str(review_a),))[0], 0)
    check('(the notice about another customer\'s review stays)', one("select count(*) from notification_outbox where template_key = 'review_admin' and payload->>'review_id' = %s", (str(review_d),))[0], 1)
    check('the quote\'s typed invoice details go from an order without a full invoice',
          one("select invoice_customer from checkout_quotes where id = %s", (q_b,))[0], None)
    check('(and stay where the order has its full invoice)', one("select invoice_customer->>'name' from checkout_quotes where id = %s", (q_a,))[0], 'Typed a')
    check('(and on the other customer\'s)', one("select invoice_customer->>'name' from checkout_quotes where id = %s", (q_d,))[0], 'Typed d')
    check('returns the order\'s review ids', res['review_ids'], [str(review_a)])
    check('and does not delete them (TypeScript does, with the photos)', one("select count(*) from reviews where id = %s", (review_a,))[0], 1)
    check('the unrelated guest is untouched', snapshot(d1), d1_before)
    check('and its invoice', one("select to_jsonb(i)::text from invoices i where order_id = %s", (d1,))[0], simple_before)
    check('the anonymized guest has no record any more', one("select admin_guest_customer(%s)", (kb,))[0], None)

    # ——— Charged and not invoiced yet: refused until the invoice exists ———
    f1 = order('PD-GST-F1', 'fede@x.test', name='Fede Mir', total=1200)
    kf = key('fede@x.test')
    denied('a charged order with no invoice blocks anonymizing, and says which', "select admin_guest_anonymize(%s)", (kf,), contains='CUSTOMER_HAS_UNINVOICED_ORDERS: PD-GST-F1')
    check('(and nothing changed)', snapshot(f1)[:2], ('Fede Mir', 'fede@x.test'))
    invoice(f1, 'simplified', 9050)
    check('once the invoice exists it is anonymized', one("select admin_guest_anonymize(%s)", (kf,))[0]['orders'], 1)

    # ——— A commission paid by transfer: no checkout attempt, its quote hangs off the request ———
    cur.execute("insert into commission_requests (reference, locale, contact_name, contact_email, message) values ('PD-GST-CR9', 'es', 'Gema', 'gema@x.test', 'Un retrato') returning id")
    cr9 = cur.fetchone()[0]
    cur.execute("""insert into checkout_quotes (cart_owner_hash, locale, lines, price_fingerprint, config_version, subtotal_cents, total_cents, expires_at, shipping_country, invoice_customer, commission_request_id)
                   values ('x', 'es', '[]', 'fp-cr9', 1, 1000, 1000, now() + interval '1 hour', 'ES', %s, %s) returning id""",
                (json.dumps({'taxId': 'X1234567L', 'name': 'Typed commission', 'address': 'Calle Encargo'}), cr9))
    q_cr = cur.fetchone()[0]
    g1 = order('PD-GST-GM1', 'gema@x.test', name='Gema Rey', total=1000)
    cur.execute("update orders set commission_request_id = %s where id = %s", (cr9, g1))
    invoice(g1, 'simplified', 9060)
    check('(a commission quote\'s typed invoice details are there before)', one("select invoice_customer->>'name' from checkout_quotes where id = %s", (q_cr,))[0], 'Typed commission')
    one("select admin_guest_anonymize(%s)", (key('gema@x.test'),))
    check('a commission quote with no checkout attempt loses its typed invoice details', one("select invoice_customer from checkout_quotes where id = %s", (q_cr,))[0], None)

    # ——— A phone that has nowhere to be kept ———
    n1 = order('PD-GST-N1', 'nuria@x.test', name='Nuria Paz')
    cur.execute("update orders set shipping_address = null where id = %s", (n1,))
    n2 = order('PD-GST-N2', 'nuria@x.test', name='Nuria Paz', age_days=3)
    res = one("select admin_guest_update(%s, 'Nuria Paz', 'nuria@x.test', '611000111')", (key('nuria@x.test'),))[0]
    check('an order without an address cannot keep the phone, and the answer says how many', (res['orders'], res['phone_skipped']), (2, 1))
    check('(the other one has it)', one("select shipping_address->>'phone' from orders where id = %s", (n2,))[0], '611000111')
    check('(no phone, nothing to skip)', one("select admin_guest_update(%s, 'Nuria Paz', 'nuria@x.test', '')", (key('nuria@x.test'),))[0]['phone_skipped'], 0)

    # ——— The account's orders ———
    ids_acct = one("select admin_account_order_ids(%s)", (acct,))[0]
    check('admin_account_order_ids: the account\'s own orders and the guest ones with its email',
          sorted(ids_acct), sorted([c1]))
    g = order('PD-GST-G1', ' CUENTA.guest@EXAMPLE.com')
    check('(a guest order with the account\'s email too)', sorted(one("select admin_account_order_ids(%s)", (acct,))[0]), sorted([c1, g]))
    check('(and an account with nothing gives an empty list)', one("select admin_account_order_ids(%s)", ('99999999-dddd-4ddd-8ddd-dddddddddddd',))[0], [])

    # ——— The list in Admin › Clientes: one row per guest, with the key that opens the record ———
    as_role('postgres')
    boss = '99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Jefa','jefa.guest@example.com',true,now())", (boss,))
    cur.execute("insert into admin_users (user_id, email) values (%s,'jefa.guest@example.com')", (boss,))
    order('PD-GST-L1', ' Eli@X.test', name='Eli Sanz', age_days=4, total=1500)
    order('PD-GST-L2', 'eli@x.test', name='Eli Sanz', age_days=1, total=500)
    as_role('authenticated', boss)
    listed = [r for r in one("select admin_customers()")[0] if r['kind'] == 'guest' and r['email'] == 'eli@x.test']
    check("' Eli@X.test' and 'eli@x.test' are one row in the list", len(listed), 1)
    check('(with both orders and their total)', (listed[0]['order_count'], listed[0]['spent_cents']), (2, 2000))
    check('the row carries the SQL guest_key', listed[0]['key'], key('eli@x.test'))
    as_role('service_role')
    opened = one("select admin_guest_customer(%s)", (listed[0]['key'],))[0]
    check("the list's key opens the record", (opened['email'], len(opened['orders'])), ('eli@x.test', 2))

    # ——— Who may call ———
    fns = [
        ("guest_key('a@b.c')", ), ("admin_guest_customer('x')", ), ("admin_guest_update('x', 'N', 'a@b.c', '')", ),
        ("guest_due_orders('{}')", ), ("anonymize_orders('{}', null)", ), ("admin_guest_anonymize('x')", ),
        (f"admin_account_order_ids('{acct}')", ),
    ]
    for role, uid in (('anon', None), ('authenticated', acct)):
        as_role(role, uid)
        for (call,) in fns:
            denied(f'{role} cannot execute {call.split("(")[0]}', f"select {call}", contains='permission denied')
    as_role('service_role')
    check('the service role can', one("select guest_key('a@b.c')")[0], key('a@b.c'))
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
