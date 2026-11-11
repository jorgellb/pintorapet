#!/usr/bin/env python3
# The order of the pieces of one type (Admin › Productos › Tazas ↑↓): who can
# change it, and that it only moves that type. One transaction, always rolled back.
# Usage: python3 scripts/sql-check-product-order.py [migration.sql ...]
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

def top_level(code):
    cur.execute("""select p.id from products p join categories c on c.id = p.category_id
                   where c.code = %s and p.parent_id is null order by p.editorial_order, p.id""", (code,))
    return [r[0] for r in cur.fetchall()]

def orders(code):
    cur.execute("""select p.id, p.editorial_order from products p join categories c on c.id = p.category_id
                   where c.code = %s and p.parent_id is null order by p.id""", (code,))
    return cur.fetchall()

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.order@example.com',now(),'authenticated','authenticated'),(%s,'ana.order@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.order@example.com')", (adm,))

    mugs = top_level('mugs')
    keyrings = top_level('keyrings')
    cards_before = orders('greeting-cards')
    cur.execute("select array_agg(editorial_order order by editorial_order) from products where id = any(%s)", (mugs,))
    mug_slots = cur.fetchone()[0]

    as_role('authenticated', ana)
    denied('customers cannot reorder products', "select public.admin_reorder_products(%s::uuid[])", (mugs[::-1],))

    as_role('authenticated', adm)
    cur.execute("select public.admin_reorder_products(%s::uuid[])", (mugs[::-1],))
    check('the admin reverses the mugs', top_level('mugs'), mugs[::-1])
    cur.execute("select array_agg(editorial_order order by editorial_order) from products where id = any(%s)", (mugs,))
    check('the mugs keep their own places in the list', cur.fetchone()[0], mug_slots)
    check('the cards do not move', orders('greeting-cards'), cards_before)

    cur.execute("select public.admin_reorder_products(%s::uuid[])", (keyrings[::-1],))
    cur.execute("""select count(*) from products v join products p on p.id = v.parent_id
                   where p.id = any(%s) and v.editorial_order <> p.editorial_order""", (keyrings,))
    check('each option follows its product', cur.fetchone()[0], 0)

    denied('two types cannot be mixed', "select public.admin_reorder_products(%s::uuid[])", ([mugs[0], keyrings[0]],))
    denied('a product cannot appear twice', "select public.admin_reorder_products(%s::uuid[])", ([mugs[0], mugs[0]],))
    cur.execute("select id from products where parent_id is not null limit 1")
    option = cur.fetchone()[0]
    denied('options are not ordered on their own', "select public.admin_reorder_products(%s::uuid[])", ([option],))
    denied('unknown products are refused', "select public.admin_reorder_products(array['00000000-0000-4000-8000-000000000000']::uuid[])")

    as_role('anon')
    cur.execute("""select v.id from catalog_products_v v where v.id = any(%s) order by v.editorial_order""", (mugs,))
    check('the shop reads the new order', [r[0] for r in cur.fetchall()], [m for m in mugs[::-1]])
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
