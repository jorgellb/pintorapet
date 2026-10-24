#!/usr/bin/env python3
# Home hero (Admin › Portada): who can read and write it.
# Runs inside one transaction that is always rolled back.
# Usage: python3 scripts/sql-check-home-hero.py [migration.sql ...]
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

def as_role(role, uid=None):
    cur.execute("reset role")
    cur.execute(f"set local role {role}")
    if uid:
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': role}),))

def denied(name, sql, args=()):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        check(name, 'allowed' if cur.rowcount != 0 else 'denied', 'denied')
    except Exception:
        check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    adm = '77777777-7777-4777-8777-777777777777'
    ana = '88888888-8888-4888-8888-888888888888'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.hero@example.com',now(),'authenticated','authenticated'),(%s,'ana.hero@example.com',now(),'authenticated','authenticated')", (adm, ana))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.hero@example.com')", (adm,))
    cur.execute("delete from site_home_hero")
    cur.execute("insert into site_home_hero (id, content) values (1, %s)", (json.dumps({'design': 'wall'}),))

    as_role('anon')
    cur.execute("select content->>'design' from site_home_hero where id = 1")
    check('visitors can read the hero', cur.fetchone()[0], 'wall')
    denied('visitors cannot change it', "update site_home_hero set content = '{\"design\":\"salon\"}' where id = 1")
    denied('visitors cannot add a row', "insert into site_home_hero (id, content) values (1, '{}')")

    as_role('authenticated', ana)
    denied('customers cannot change it', "update site_home_hero set content = '{\"design\":\"salon\"}' where id = 1")
    denied('customers cannot delete it', "delete from site_home_hero where id = 1")

    as_role('authenticated', adm)
    cur.execute("update site_home_hero set content = '{\"design\":\"salon\"}' where id = 1")
    check('the admin can change it', cur.rowcount, 1)
    denied('there is only one hero', "insert into site_home_hero (id, content) values (2, '{}')")
    denied('the content must be an object', "update site_home_hero set content = '[]' where id = 1")
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
