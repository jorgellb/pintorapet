#!/usr/bin/env python3
# Full invoice on request (F3 replacement) and customer invoice access.
# Applies the migration and runs every check inside one transaction that is always rolled back.
import json, sys, psycopg

def env():
    out = {}
    for line in open('.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k] = v.strip().strip('"').strip("'")
    return out

e = env()
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

def as_user(uid, email):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'email': email, 'role': 'authenticated'}),))

def as_owner():
    cur.execute("reset role")

def raises(name, sql, args, code):
    cur.execute("savepoint t")
    try:
        cur.execute(sql, args)
        check(name, 'no error', code)
    except Exception as ex:
        cur.execute("rollback to savepoint t")
        check(name, code in str(ex), True)

try:
    if len(sys.argv) > 1:
        cur.execute(open(sys.argv[1]).read())
    a = '11111111-1111-4111-8111-111111111111'
    b = '22222222-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'ana.test@example.com',now(),'authenticated','authenticated'),(%s,'bea.test@example.com',now(),'authenticated','authenticated')", (a, b))
    cur.execute("""update shop_settings set invoice_config = coalesce(invoice_config,'{}'::jsonb) || jsonb_build_object(
      'issuerName','Estudio de Prueba','issuerNif','89890001K','issuerAddress','Calle Test 1',
      'issuerPostalCode','28013','issuerCity','Madrid','issuerKind','autonomo') where id = 1""")
    cur.execute("select public.invoice_config_complete()")
    check('test fiscal data is complete', cur.fetchone()[0], True)

    def paid_order(ref, email):
        cur.execute("""insert into orders (reference, access_token_hash, payment_status, locale, currency, subtotal_cents, shipping_cents, tax_cents, total_cents, customer_email, shipping_country, shipping_postal_code)
          values (%s, encode(digest('t'||%s||repeat('x',24),'sha256'),'hex'), 'processing','es','EUR',999,590,0,1589,%s,'ES','46001') returning id""", (ref, ref, email))
        oid = cur.fetchone()[0]
        cur.execute("insert into order_items (order_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents) values (%s,'Taza de prueba','TEST-SKU',999,1,999)", (oid,))
        cur.execute("update orders set payment_status='paid', paid_at=now() where id=%s", (oid,))  # fires the invoice trigger
        return oid

    oa = paid_order('TEST-R1', 'ana.test@example.com')
    cur.execute("select kind, full_number from invoices where order_id=%s", (oa,))
    kind, simplified = cur.fetchone()
    check('paying issues a simplified invoice', kind, 'simplified')

    customer = {'taxId': '12345678-z', 'name': 'Ana García', 'address': 'Calle de la Paz 14', 'postalCode': '46001', 'city': 'Valencia', 'country': 'es'}
    as_user(b, 'bea.test@example.com')
    raises('another customer cannot ask for it', "select public.request_full_invoice('TEST-R1', %s)", (json.dumps(customer),), 'ORDER_NOT_FOUND')
    as_owner()

    as_user(a, 'ana.test@example.com')
    raises('a wrong NIF is refused', "select public.request_full_invoice('TEST-R1', %s)", (json.dumps({**customer, 'taxId': '12345678A'}),), 'INVALID_TAX_ID')
    cur.execute("select public.request_full_invoice('TEST-R1', %s)", (json.dumps(customer),))
    res = cur.fetchone()[0]
    check('the request issues the full invoice', res['status'], 'issued')
    cur.execute("select public.customer_invoice(%s)", (res['invoice_id'],))
    inv = cur.fetchone()[0]
    check('it is a full invoice', inv['kind'], 'full')
    check('it replaces the simplified one', inv['replaces_number'], simplified)
    check('the NIF is normalised', inv['customer']['taxId'], '12345678Z')
    check('same total as the simplified one', inv['total_cents'], 1589)
    cur.execute("select public.request_full_invoice('TEST-R1', %s)", (json.dumps(customer),))
    check('asking again changes nothing', cur.fetchone()[0]['status'], 'already')
    cur.execute("select jsonb_array_length(public.customer_order('TEST-R1')->'invoices')")
    check('the order lists both invoices', cur.fetchone()[0], 2)
    as_owner()

    cur.execute("select (public.current_invoice(%s)).full_number", (oa,))
    check('the current invoice is the full one', cur.fetchone()[0], inv['full_number'])
    cur.execute("select public.lookup_guest_order('TEST-R1', 'tTEST-R1'||repeat('x',24))->>'invoice_kind'")
    check('guest lookup still works with two invoices', cur.fetchone()[0], 'full')
    cur.execute("select hash, prev_hash from invoices where id=%s", (res['invoice_id'],))
    h, prev = cur.fetchone()
    cur.execute("select hash from invoices where full_number=%s", (simplified,))
    check('the hash chain continues from the previous invoice', prev, cur.fetchone()[0])
    raises('invoices stay immutable', "update invoices set total_cents = 1 where id = %s", (res['invoice_id'],), 'INVOICE_IMMUTABLE')

    as_user(b, 'bea.test@example.com')
    raises('another customer cannot read the invoice', "select public.customer_invoice(%s)", (res['invoice_id'],), 'INVOICE_NOT_FOUND')
    as_owner()

    # An order paid while fiscal data was missing: the request saves the data, then issuing makes it full.
    cur.execute("update shop_settings set invoice_config = invoice_config - 'issuerNif' where id = 1")
    ob = paid_order('TEST-R2', 'ana.test@example.com')
    cur.execute("select count(*) from invoices where order_id=%s", (ob,))
    check('no invoice without fiscal data', cur.fetchone()[0], 0)
    as_user(a, 'ana.test@example.com')
    cur.execute("select public.request_full_invoice('TEST-R2', %s)", (json.dumps(customer),))
    check('the request is kept for later', cur.fetchone()[0]['status'], 'saved')
    as_owner()
    cur.execute("update shop_settings set invoice_config = invoice_config || '{\"issuerNif\":\"89890001K\"}' where id = 1")
    cur.execute("select public.issue_invoice(%s)", (ob,))
    cur.execute("select kind from invoices where id = %s", (cur.fetchone()[0],))
    check('issued later, it is already full', cur.fetchone()[0], 'full')
except Exception as ex:
    bad += 1
    print('ERROR', ex)
finally:
    conn.rollback()
    print(f'ROLLED BACK · {ok} ok, {bad} failed')
sys.exit(1 if bad else 0)
