#!/usr/bin/env python3
# Anti-bot gate: rate limits, single-use challenges and who may call what.
# Runs inside one transaction that is always rolled back.
# Usage: python3 scripts/sql-check-antibot.py [migration.sql]
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
        check(name, 'allowed', 'denied')
    except Exception:
        check(name, 'denied', 'denied')
    cur.execute("rollback to savepoint s")

def gate(form, ip, email=None, nonce=None, verdict='allow', score=0, reasons=()):
    cur.execute("select public.antibot_gate(%s,%s,%s,%s,%s,%s,%s,%s)",
                (form, ip, email, 'a***@x.es' if email else None, nonce, verdict, score, list(reasons)))
    return cur.fetchone()[0]

try:
    if len(sys.argv) > 1:
        cur.execute(open(sys.argv[1]).read())
    ip = 'i' * 40; ip2 = 'j' * 40; em = 'e' * 40
    adm = '55555555-5555-4555-8555-555555555555'
    cur.execute("insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s,'boss.ab@example.com',now(),'authenticated','authenticated')", (adm,))
    cur.execute("insert into admin_users (user_id, email) values (%s,'boss.ab@example.com')", (adm,))

    as_role('anon')
    denied('anon cannot call the gate', "select public.antibot_gate('register','x','x',null,null,'allow',0,'{}')")
    denied('anon cannot read the log', "select * from public.antibot_events")
    as_role('authenticated', '66666666-6666-4666-8666-666666666666')
    denied('a signed-in visitor cannot call the gate', "select public.antibot_gate('register','x','x',null,null,'allow',0,'{}')")
    denied('a signed-in visitor cannot write the log', "insert into public.antibot_events (form, ip_hash, verdict) values ('register', %s, 'allow')", (ip,))
    denied('a signed-in visitor cannot see the summary', "select public.admin_antibot_summary(7)")

    as_role('service_role')
    check('first registration passes', gate('register', ip, em, 'n' * 22 + '01')['verdict'], 'allow')
    check('the same challenge twice is a replay', gate('register', ip, em, 'n' * 22 + '01'), {'verdict': 'block', 'reasons': ['replay']})
    check('a server block stays a block', gate('register', ip, em, 'n' * 22 + '02', 'block', 100, ['honeypot'])['verdict'], 'block')
    check('third attempt from the IP is the limit', gate('register', ip, None, 'n' * 22 + '03'), {'verdict': 'rate', 'reasons': ['rate_ip']})
    check('another IP is not limited', gate('register', ip2, None, 'n' * 22 + '04')['verdict'], 'allow')
    check('limits are per form', gate('contact', ip, None, 'n' * 22 + '05')['verdict'], 'allow')
    gate('forgot', ip2, em, 'n' * 22 + '06'); gate('forgot', ip2, em, 'n' * 22 + '07'); gate('forgot', ip2, em, 'n' * 22 + '08')
    check('the inbox limit for password links', gate('forgot', ip, em, 'n' * 22 + '09'), {'verdict': 'rate', 'reasons': ['rate_email']})
    cur.execute("select public.antibot_pressure(%s)", (ip,))
    check('stopped attempts raise the pressure on the IP', cur.fetchone()[0], 4)
    cur.execute("savepoint s")
    try:
        gate('nope', ip); check('unknown forms are rejected', 'accepted', 'rejected')
    except Exception:
        check('unknown forms are rejected', 'rejected', 'rejected')
    cur.execute("rollback to savepoint s")
    cur.execute("savepoint s")
    try:
        gate('register', ip, verdict='rate'); check('the caller cannot pick the rate verdict', 'accepted', 'rejected')
    except Exception:
        check('the caller cannot pick the rate verdict', 'rejected', 'rejected')
    cur.execute("rollback to savepoint s")

    as_role('authenticated', adm)
    cur.execute("select public.admin_antibot_summary(7)")
    summary = cur.fetchone()[0]
    reasons = {r['reason']: r['count'] for r in summary['by_reason']}
    check('the admin sees replays', reasons.get('replay', 0) >= 1, True)
    check('the admin sees rate limits', reasons.get('rate_ip', 0) >= 1, True)
    check('stopped attempts are listed', any(r['form'] == 'register' and 'honeypot' in r['reasons'] for r in summary['recent']), True)
    check('the admin never sees the full hash', all(len(r['ip']) == 8 for r in summary['recent']), True)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
