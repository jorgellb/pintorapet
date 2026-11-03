#!/usr/bin/env python3
# Shop categories (Admin › Tienda › Categorías): who can read and change them,
# and what happens to their products. One transaction, always rolled back.
# Usage: python3 scripts/sql-check-shop-categories.py [migration.sql ...]
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
    'anon': 'set local role anon',
    'authenticated': 'set local role authenticated',
    'service_role': 'set local role service_role',
}

def as_role(role, uid=None):
    cur.execute("reset role")
    cur.execute(SET_ROLE[role])
    if uid:
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': role}),))

def denied(name, sql, args=()):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        check(name, 'allowed' if cur.rowcount not in (0, -1) else 'denied', 'denied')
    except Exception:
        check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.cat@example.com',now(),'authenticated','authenticated'),(%s,'ana.cat@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.cat@example.com')", (adm,))
    cur.execute("insert into shop_collections (code, name_es, name_en, published) values ('zz-hidden','Oculta','Hidden', false) returning id")
    hidden = cur.fetchone()[0]

    as_role('anon')
    cur.execute("select count(*) from catalog_collections_v where code in ('pug','zz-hidden')")
    check('visitors see visible categories only', cur.fetchone()[0], 1)
    denied('visitors cannot read the table itself', "select * from shop_collections")
    cur.execute("select count(*) from catalog_products_v where collection_id is not null")
    check('the shop sees each product’s category', cur.fetchone()[0] > 0, True)

    as_role('authenticated', ana)
    denied('customers cannot create categories', "insert into shop_collections (code, name_es, name_en) values ('x','X','X')")
    denied('customers cannot rename one', "update shop_collections set name_es = 'Hack' where code = 'pug'")
    denied('customers cannot move products', "update products set collection_id = null where motif = 'Pug'")
    denied('customers cannot reorder the shop', "select public.admin_reorder_shop_collections(array(select id from shop_collections))")

    as_role('authenticated', adm)
    cur.execute("select public.admin_reorder_shop_collections(array(select id from shop_collections where code in ('pug','cockapoo') order by code desc))")
    cur.execute("select code, sort_order from shop_collections where code in ('pug','cockapoo') order by sort_order")
    check('the admin reorders the shop in one go', cur.fetchall(), [('pug', 10), ('cockapoo', 20)])
    cur.execute("insert into shop_collections (code, name_es, name_en) values ('galgo','Galgo','Greyhound') returning id")
    galgo = cur.fetchone()[0]
    check('the admin creates a category', galgo is not None, True)
    denied('the address must be lowercase words', "insert into shop_collections (code, name_es, name_en) values ('Galgo Español','G','G')")
    denied('two categories cannot share an address', "insert into shop_collections (code, name_es, name_en) values ('galgo','G','G')")
    denied('a category needs a name', "insert into shop_collections (code, name_es, name_en) values ('sin-nombre','  ','G')")
    cur.execute("update products set collection_id = %s where sku = 'PD-2051' returning id", (galgo,))
    check('the admin moves a product', cur.rowcount, 1)
    cur.execute("delete from shop_collections where id = %s", (galgo,))
    cur.execute("select collection_id from products where sku = 'PD-2051'")
    check('deleting a category keeps its products, without one', cur.fetchone()[0], None)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
