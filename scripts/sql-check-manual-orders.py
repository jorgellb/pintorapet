#!/usr/bin/env python3
# Orders taken by phone and paid by bank transfer (Admin › Pedidos › Nuevo pedido):
# prices, shipping, stock reservation, payment, cancellation. One transaction,
# always rolled back. Runs on the local Docker PostgreSQL (scripts/aiven/local-db.sh).
# Usage: LOCAL_PG_URL=... python3 scripts/sql-check-manual-orders.py
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

CONFIG = json.dumps({
    'issuerName': 'MEILI STRINGFELLOW PRUEBA', 'issuerNif': '89890001K', 'issuerAddress': 'Calle Mayor 1',
    'issuerPostalCode': '28013', 'issuerCity': 'Madrid', 'issuerKind': 'autonomo',
    'simplifiedPrefix': 'T', 'fullPrefix': 'U', 'rectifyingPrefix': 'V', 'shippingVatRate': 21, 'verifactuEnabled': False,
})

try:
    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, name, email, email_verified, email_confirmed_at) values (%s,'Boss','boss.manual@example.com',true,now()),(%s,'Ana','ana.manual@example.com',true,now())", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.manual@example.com')", (adm,))
    cur.execute("insert into shop_settings (id) values (1) on conflict (id) do nothing")
    cur.execute("update shop_settings set invoice_config = %s::jsonb where id = 1", (CONFIG,))
    cat, = one("select id from categories order by sort_order limit 1")
    mug, = one("""insert into products (sku, category_id, motif, status, price_cents, editorial_order, sale_enabled, weight_grams)
                  values ('T-MUG', %s, 'Pug', 'published', 999, 99001, true, 400) returning id""", (cat,))
    cur.execute("insert into product_translations (product_id, locale, slug, title) values (%s,'es','taza-t','Taza Pug'),(%s,'en','mug-t','Pug Mug')", (mug, mug))
    cur.execute("insert into inventory (product_id, inventory_mode, stock_on_hand, verified_at) values (%s,'tracked',5,now()) on conflict (product_id) do update set inventory_mode='tracked', stock_on_hand=5, stock_reserved=0, verified_at=now()", (mug,))
    stock = lambda: one("select stock_on_hand, stock_reserved from inventory where product_id = %s", (mug,))

    def order(qty=2, country='ES', cp='28013', **extra):
        body = {'lines': [{'product_id': str(mug), 'quantity': qty}], 'country': country, 'postal_code': cp, 'locale': 'es',
                'customer': {'name': 'Lucía Teléfono', 'email': 'ana.manual@example.com', 'phone': '600111222'},
                'address': {'line1': 'Calle de la Paz 14', 'city': 'Valencia', 'note': 'Llamó el lunes'}}
        body.update(extra)
        return json.dumps(body)

    as_role('authenticated', ana)
    denied('a customer cannot create orders', "select public.admin_create_manual_order(%s::jsonb)", (order(),))
    denied('nor mark one paid', "select public.admin_mark_order_paid(gen_random_uuid())")

    as_role('authenticated', adm)
    q = one("select public.admin_quote_manual_order(%s::jsonb)", (order(),))[0]
    check('quote: catalogue price', (q['subtotal_cents'], q['vat_regime']), (1998, 'es_vat'))
    check('quote: the zone’s shipping', q['shipping_cents'] is not None and q['shipping_cents'] > 0 and q['total_cents'] == 1998 + q['shipping_cents'], True)
    q = one("select public.admin_quote_manual_order(%s::jsonb)", (order(country='ES', cp='38001'),))[0]
    check('Canarias pays no Spanish VAT, as on the web', (q['vat_regime'], q['lines'][0]['unit_price_cents']), ('no_vat', 826))
    q = one("select public.admin_quote_manual_order(%s::jsonb)", (order(shipping_cents=0),))[0]
    check('shipping can be set by hand', (q['shipping_cents'], q['total_cents']), (0, 1998))

    # ——— Created awaiting the transfer ———
    created = one("select public.admin_create_manual_order(%s::jsonb)", (order(),))[0]
    o = one("""select payment_status::text, payment_provider, customer_name, shipping_address->>'phone', shipping_address->>'note',
                      shipping_country, vat_regime, customer_id is not null, paid_at is null from orders where id = %s""", (created['order_id'],))
    check('created awaiting the transfer', o, ('awaiting_transfer', 'transfer', 'Lucía Teléfono', '600111222', 'Llamó el lunes', 'ES', 'es_vat', True, True))
    check('its pieces are reserved', stock(), (5, 2))
    check('no invoice yet', one("select count(*) from invoices where order_id = %s", (created['order_id'],))[0], 0)
    denied('no more pieces than are free', "select public.admin_create_manual_order(%s::jsonb)", (order(qty=4),), contains='INSUFFICIENT_STOCK')
    denied('a name is needed', "select public.admin_create_manual_order(%s::jsonb)", (order(customer={'name': ''}),), contains='MANUAL_ORDER_NAME')
    denied('a valid email or none', "select public.admin_create_manual_order(%s::jsonb)", (order(customer={'name': 'Ana', 'email': 'no-es-email'}),), contains='MANUAL_ORDER_EMAIL')
    denied('an address is needed', "select public.admin_create_manual_order(%s::jsonb)", (order(address={'line1': '', 'city': ''}),), contains='MANUAL_ORDER_ADDRESS')
    denied('invoice data follows the web’s rules', "select public.admin_create_manual_order(%s::jsonb)",
           (order(invoice_customer={'taxId': '123', 'name': 'X', 'address': 'C', 'postalCode': '1', 'city': 'M', 'country': 'ES'}),), contains='INVALID_TAX_ID')

    # ——— The transfer arrives ———
    cur.execute("select public.admin_mark_order_paid(%s)", (created['order_id'],))
    check('marked paid', one("select payment_status::text, paid_at is not null from orders where id = %s", (created['order_id'],)), ('paid', True))
    check('the pieces leave the stock', stock(), (3, 0))
    check('as a sale in the stock ledger', one("select count(*), sum(quantity_delta) from stock_movements where order_id = %s and reason = 'sale'", (created['order_id'],)), (1, -2))
    check('the invoice is issued', one("select kind from invoices where order_id = %s", (created['order_id'],))[0], 'simplified')
    check('the customer is emailed', one("select count(*) from notification_outbox where template_key = 'order_paid_customer' and payload->>'order_id' = %s", (created['order_id'],))[0], 1)
    cur.execute("select public.admin_mark_order_paid(%s)", (created['order_id'],))
    check('marking it paid twice changes nothing', stock(), (3, 0))

    # ——— Created already paid, with invoice data ———
    company = {'taxId': '89890001K', 'name': 'Empresa SL', 'address': 'C/ Uno 1', 'postalCode': '28013', 'city': 'Madrid', 'country': 'ES'}
    paid = one("select public.admin_create_manual_order(%s::jsonb)", (order(qty=1, paid=True, invoice_customer=company),))[0]
    check('created paid at once, with a full invoice', one("select o.payment_status::text, i.kind from orders o join invoices i on i.order_id = o.id where o.id = %s", (paid['order_id'],)), ('paid', 'full'))
    check('stock after it', stock(), (2, 0))

    # ——— Cancelled before paying ———
    pending = one("select public.admin_create_manual_order(%s::jsonb)", (order(qty=2),))[0]
    check('reserved again', stock(), (2, 2))
    cur.execute("select public.admin_cancel_order(%s)", (pending['order_id'],))
    check('cancelling frees the pieces', stock(), (2, 0))
    check('and the order is cancelled', one("select payment_status::text from orders where id = %s", (pending['order_id'],))[0], 'cancelled')
    denied('a cancelled order cannot be paid', "select public.admin_mark_order_paid(%s)", (pending['order_id'],), contains='ORDER_NOT_AWAITING_TRANSFER')
    cur.execute("select public.admin_delete_order(%s)", (pending['order_id'],))
    check('then it can be deleted', one("select count(*) from orders where id = %s", (pending['order_id'],))[0], 0)

    # ——— A web order is not a transfer order ———
    as_role('postgres')
    web, = one("""insert into orders (reference, locale, subtotal_cents, shipping_cents, total_cents, access_token_hash, payment_status, payment_provider)
                  values ('PD-WEB-T', 'es', 999, 0, 999, 'x', 'checkout_open', 'stripe') returning id""")
    as_role('authenticated', adm)
    denied('a web order is not marked paid by hand', "select public.admin_mark_order_paid(%s)", (web,), contains='ORDER_NOT_AWAITING_TRANSFER')

    # ——— Refunds go back by transfer ———
    item, = one("select id from order_items where order_id = %s", (created['order_id'],))
    r = one("select public.admin_begin_refund(%s, %s::jsonb, false, true, 'Devuelto por transferencia', true)",
            (created['order_id'], json.dumps([{'order_item_id': str(item), 'quantity': 1}])))[0]
    check('a refund registered by hand', (r['status'], r['amount_cents']), ('succeeded', 999))
    check('and the order is partly refunded', one("select payment_status::text from orders where id = %s", (created['order_id'],))[0], 'partially_refunded')
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
