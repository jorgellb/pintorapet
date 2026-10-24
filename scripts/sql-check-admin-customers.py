#!/usr/bin/env python3
# Admin customer list and detail. Runs inside one transaction that is always rolled back.
# Usage: python3 scripts/sql-check-admin-customers.py [migration.sql]
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

def as_user(uid):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': 'authenticated'}),))

try:
    if len(sys.argv) > 1:
        cur.execute(open(sys.argv[1]).read())
    adm = '33333333-3333-4333-8333-333333333333'
    ana = '44444444-4444-4444-8444-444444444444'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.test@example.com',now(),'authenticated','authenticated'),(%s,'ana.test@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.test@example.com')", (adm,))
    cur.execute("insert into customers (id, full_name, phone) values (%s,'Ana Test','600000000')", (ana,))
    def order(ref, email, status, total, customer=None):
        cur.execute("""insert into orders (reference, access_token_hash, payment_status, locale, currency, subtotal_cents, shipping_cents, tax_cents, total_cents, customer_email, customer_name, customer_id)
          values (%s,'x',%s,'es','EUR',%s,0,0,%s,%s,'Nombre Pedido',%s)""", (ref, status, total, total, email, customer))
    order('T-1', 'ana.test@example.com', 'paid', 1000)
    order('T-2', 'ANA.test@example.com', 'paid', 500, ana)
    order('T-3', 'guest.test@example.com', 'paid', 700)
    order('T-4', 'guest.test@example.com', 'checkout_open', 9999)

    as_user(ana)
    cur.execute("savepoint s")
    try:
        cur.execute("select public.admin_customers()"); check('a customer cannot list customers', 'listed', 'forbidden')
    except Exception as ex:
        cur.execute("rollback to savepoint s"); check('a customer cannot list customers', 'FORBIDDEN' in str(ex), True)
    cur.execute("reset role")

    as_user(adm)
    cur.execute("select public.admin_customers()")
    rows = {r['email']: r for r in cur.fetchone()[0] if r['email'] and r['email'].endswith('.test@example.com')}
    check('the account is listed', rows['ana.test@example.com']['kind'], 'account')
    check('its orders are counted by link and by email', rows['ana.test@example.com']['order_count'], 2)
    check('what it spent', rows['ana.test@example.com']['spent_cents'], 1500)
    check('the guest buyer is listed', rows['guest.test@example.com']['kind'], 'guest')
    check('an open checkout is not a purchase', rows['guest.test@example.com']['spent_cents'], 700)
    check('admins are marked', rows['boss.test@example.com']['is_admin'], True)
    cur.execute("select public.admin_customer(%s)", (ana,))
    d = cur.fetchone()[0]
    check('the detail has the profile', d['full_name'], 'Ana Test')
    check('the detail lists both orders', len(d['orders']), 2)
finally:
    conn.rollback()
    print(f'ROLLED BACK · {ok} ok, {bad} failed')
sys.exit(1 if bad else 0)
