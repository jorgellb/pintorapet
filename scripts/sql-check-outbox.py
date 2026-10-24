#!/usr/bin/env python3
# Outbox: order emails claimed on their own, and the order of the daily run.
# Runs inside one transaction that is always rolled back.
# Usage: python3 scripts/sql-check-outbox.py [migration.sql ...]
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

def denied(name, sql, args=()):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        check(name, 'allowed', 'denied')
    except Exception:
        check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

A = '11111111-aaaa-4aaa-8aaa-111111111111'
B = '22222222-bbbb-4bbb-8bbb-222222222222'

def row(key, template, order=None, minutes_ago=1, recipient='x@example.com'):
    payload = json.dumps({'order_id': order} if order else {})
    cur.execute("""insert into notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at)
                   values (%s, %s, 'es', %s, %s, 'pending', now() - make_interval(mins => %s))""",
                (key, recipient, template, payload, minutes_ago))

try:
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
    # Park anything real so the checks only see their own rows.
    cur.execute("update notification_outbox set next_run_at = now() + interval '1 year' where status in ('pending', 'failed')")

    row('t:a:paid', 'order_paid_customer', A)
    row('t:a:admin', 'order_paid_admin', A, recipient='admin')
    row('t:b:paid', 'order_paid_customer', B)
    row('t:b:admin', 'order_paid_admin', B, 60 * 24 * 2, recipient='admin')
    row('t:contact', 'contact_admin', None, 60 * 24)
    row('t:fake', 'contact_admin', None)
    cur.execute("update notification_outbox set payload = jsonb_build_object('order_id', %s::text) where dedupe_key = 't:fake'", (A,))

    cur.execute("set local role service_role")
    cur.execute("select dedupe_key from public.claim_outbox_for_order(%s, 60, 'test') order by 1", (A,))
    check("an order's emails are claimed on their own", [r[0] for r in cur.fetchall()], ['t:a:admin', 't:a:paid'])
    cur.execute("select count(*) from public.claim_outbox_for_order(%s, 60, 'test')", (A,))
    check('claimed rows are not claimed twice', cur.fetchone()[0], 0)

    sequence = []
    for _ in range(4):
        cur.execute("select dedupe_key from public.claim_outbox(1, 60, 'cron')")
        sequence.append(cur.fetchone()[0])
    check('the daily run: customers first, the studio after, messages last',
          sequence, ['t:b:paid', 't:b:admin', 't:contact', 't:fake'])
    cur.execute("reset role")

    cur.execute("set local role anon")
    denied('anon cannot claim order emails', "select * from public.claim_outbox_for_order(%s)", (A,))
    cur.execute("reset role")
    cur.execute("set local role authenticated")
    denied('a signed-in visitor cannot claim order emails', "select * from public.claim_outbox_for_order(%s)", (A,))
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
