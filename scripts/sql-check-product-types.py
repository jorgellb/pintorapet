#!/usr/bin/env python3
# Product types (Admin › Tienda › Tipos de producto): what each type says and
# sets, who can change them, and what the shop reads. One transaction, always
# rolled back.
# Usage: python3 scripts/sql-check-product-types.py [migration.sql ...]
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

NEW_TYPE = """insert into categories (code, name_es, name_en, singular_es, singular_en, slug_es, slug_en,
                                      icon, default_weight_grams, vat_rate, sort_order)
              values ('laminas', 'Láminas', 'Prints', 'Lámina', 'Print', 'laminas', 'laminas', 'print', 120, 10, 60)
              returning id"""

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    adm = '99999999-1111-4111-8111-111111111111'
    ana = '99999999-2222-4222-8222-222222222222'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.types@example.com',now(),'authenticated','authenticated'),(%s,'ana.types@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.types@example.com')", (adm,))

    # What the five types say today, as the shop showed them.
    cur.execute("""select code, name_es, singular_es, phrase_es, name_en, singular_en, phrase_en, icon, default_weight_grams, vat_rate::int
                   from categories order by sort_order""")
    check('the five types keep what the shop said', cur.fetchall(), [
        ('greeting-cards', 'Tarjetas', 'Tarjeta', '', 'Cards', 'Card', '', 'card', 30, 21),
        ('coasters', 'Posavasos', 'Posavasos', '', 'Coasters', 'Coaster', '', 'coaster', 90, 21),
        ('mugs', 'Tazas', 'Taza', '', 'Mugs', 'Mug', '', 'mug', 450, 21),
        ('ornaments', 'Bolas de Navidad', 'Bola de Navidad', '', 'Christmas ornaments', 'Christmas ornament', 'Christmas ornament', 'ornament', 60, 21),
        ('keyrings', 'Llaveros', 'Llavero', '', 'Keyrings', 'Keyring', '', 'keyring', 20, 21),
    ])

    as_role('anon')
    cur.execute("select code from catalog_categories_v order by sort_order")
    check('visitors read the types in order', [r[0] for r in cur.fetchall()], ['greeting-cards', 'coasters', 'mugs', 'ornaments', 'keyrings'])
    denied('visitors cannot read the table itself', "select * from categories")

    as_role('authenticated', ana)
    denied('customers cannot rename a type', "update categories set name_es = 'Hack' where code = 'mugs'")
    denied('customers cannot create a type', NEW_TYPE)
    denied('customers cannot reorder the types', "select public.admin_reorder_product_types(array(select id from categories))")

    as_role('authenticated', adm)
    cur.execute(NEW_TYPE)
    prints = cur.fetchone()[0]
    check('the admin creates a type', prints is not None, True)
    denied('a type needs a singular name', "update categories set singular_es = ' ' where id = %s", (prints,))
    denied('only the icons the shop can draw', "update categories set icon = 'rocket' where id = %s", (prints,))
    denied('only Spanish VAT rates', "update categories set vat_rate = 7 where id = %s", (prints,))
    denied('a weight between 1 g and 30 kg', "update categories set default_weight_grams = 0 where id = %s", (prints,))

    # A new product takes its type's weight and VAT.
    cur.execute("""insert into products (sku, category_id, motif, status, price_cents, editorial_order)
                   values ('PD-TEST-TYPE', %s, 'Pug', 'published', 1500, 99999) returning weight_grams, vat_rate::int, id""", (prints,))
    weight, vat, product = cur.fetchone()
    check('a new product weighs what its type says', weight, 120)
    check('a new product pays its type’s VAT', vat, 10)
    cur.execute("insert into inventory (product_id) values (%s)", (product,))
    denied('a type with products cannot be deleted', "delete from categories where id = %s", (prints,))

    cur.execute("update categories set published = false where code = 'ornaments'")
    cur.execute("select public.admin_reorder_product_types(array(select id from categories order by (code = 'keyrings') desc, sort_order))")
    as_role('anon')
    cur.execute("select code from catalog_categories_v order by sort_order")
    codes = [r[0] for r in cur.fetchall()]
    check('a hidden type leaves the shop', 'ornaments' in codes, False)
    check('the admin’s order reaches the shop', codes[:2], ['keyrings', 'greeting-cards'])
    cur.execute("select count(*) from catalog_products_v where category_code = 'ornaments'")
    check('its product pages stay (only the shop list hides them)', cur.fetchone()[0] > 0, True)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
