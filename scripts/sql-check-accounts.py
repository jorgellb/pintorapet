#!/usr/bin/env python3
# Customer account access checks, run inside a transaction that is always rolled back.
import psycopg, json
e={}
for line in open('.env'):
    line=line.strip()
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); e[k]=v.strip().strip('"').strip("'")
conn=psycopg.connect(host=e['SUPABASE_DB_POOLER'],port=5432,user=e['SUPABASE_DB_POOLER_USER'],password=e['SUPABASE_DB_PASSWORD'],dbname='postgres',sslmode='require')
cur=conn.cursor()
ok=0; bad=0
def check(name, got, want):
    global ok, bad
    if got==want: ok+=1; print('OK  ', name)
    else: bad+=1; print('FAIL', name, 'got', got, 'want', want)
try:
    a='11111111-1111-4111-8111-111111111111'; b='22222222-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'ana.test@example.com',now(),'authenticated','authenticated'),(%s,'bea.test@example.com',null,'authenticated','authenticated')",(a,b))
    # order A by email (guest), order B linked to b, order C abandoned for a
    cur.execute("select column_name from information_schema.columns where table_name='orders' and is_nullable='NO' and column_default is null")
    print('orders required cols:', [r[0] for r in cur.fetchall()])
    cur.execute("""insert into orders (reference, access_token_hash, payment_status, locale, currency, subtotal_cents, shipping_cents, tax_cents, total_cents, customer_email)
      values ('TEST-A','x','paid','es','EUR',999,590,0,1589,'ANA.test@example.com') returning id, reference""")
    oa, ra = cur.fetchone()
    cur.execute("""insert into orders (reference, access_token_hash, payment_status, locale, currency, subtotal_cents, shipping_cents, tax_cents, total_cents, customer_email, customer_id)
      values ('TEST-B','x','paid','es','EUR',349,0,0,349,'bea.test@example.com', %s) returning id, reference""",(b,))
    ob, rb = cur.fetchone()
    cur.execute("""insert into orders (reference, access_token_hash, payment_status, locale, currency, subtotal_cents, shipping_cents, tax_cents, total_cents, customer_email)
      values ('TEST-C','x','checkout_open','es','EUR',100,0,0,100,'ana.test@example.com') returning reference""")
    rc = cur.fetchone()[0]
    def as_user(uid, email):
        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub':uid,'email':email,'role':'authenticated'}),))
    cur.execute("savepoint s1")
    as_user(a,'ana.test@example.com')
    cur.execute("select public.customer_orders()")
    refs=[o['reference'] for o in cur.fetchone()[0]]
    check('ana sees her guest order by email', ra in refs, True)
    check('ana does not see bea order', rb in refs, False)
    check('ana does not see abandoned checkout', rc in refs, False)
    cur.execute("select public.customer_order(%s)->>'reference'",(ra,))
    check('ana opens her order', cur.fetchone()[0], ra)
    try:
        cur.execute("savepoint s2"); cur.execute("select public.customer_order(%s)",(rb,)); check('ana blocked from bea order', 'opened', 'blocked')
    except Exception as ex:
        cur.execute("rollback to savepoint s2"); check('ana blocked from bea order', 'ORDER_NOT_FOUND' in str(ex), True)
    cur.execute("select count(*) from customers")
    check('ana reads only own profile rows', cur.fetchone()[0], 0)
    cur.execute("rollback to savepoint s1")
    cur.execute("savepoint s3")
    as_user(b,'bea.test@example.com')
    cur.execute("select public.customer_orders()")
    refs=[o['reference'] for o in cur.fetchone()[0]]
    check('bea (unconfirmed email) sees linked order', rb in refs, True)
    check('bea does not see ana order', ra in refs, False)
    try:
        cur.execute("savepoint s4"); cur.execute("insert into customers (id, full_name) values (%s,'x')",(a,)); check('bea cannot write ana profile','written','blocked')
    except Exception as ex:
        cur.execute("rollback to savepoint s4"); check('bea cannot write ana profile', 'row-level security' in str(ex), True)
    cur.execute("insert into customers (id, full_name) values (%s,'Bea')",(b,))
    check('bea writes her own profile', cur.rowcount, 1)
    try:
        cur.execute("savepoint s5"); cur.execute("select count(*) from orders"); n=cur.fetchone()[0]; check('bea cannot read orders table directly', n, 0)
    except Exception as ex:
        cur.execute("rollback to savepoint s5"); check('bea cannot read orders table directly', 'permission denied' in str(ex), True)
finally:
    conn.rollback(); print(f'ROLLED BACK · {ok} ok, {bad} failed')
