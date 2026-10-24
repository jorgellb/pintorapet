#!/usr/bin/env python3
# Anti-bot gate: rate limits, single-use challenges and who may call what.
# Runs inside one transaction that is always rolled back.
# Usage: python3 scripts/sql-check-antibot.py [migration.sql ...]
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
    for migration in sys.argv[1:]:
        cur.execute(open(migration).read())
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
    check('blocked attempts do not use up the limit', gate('register', ip, None, 'n' * 22 + '03')['verdict'], 'allow')
    gate('register', ip, None, 'n' * 22 + '0a')
    check('the fourth solved attempt from the IP is the limit', gate('register', ip, None, 'n' * 22 + '0b'), {'verdict': 'rate', 'reasons': ['rate_ip']})
    check('another IP is not limited', gate('register', ip2, None, 'n' * 22 + '04')['verdict'], 'allow')
    check('limits are per form', gate('contact', ip, None, 'n' * 22 + '05')['verdict'], 'allow')
    gate('forgot', ip2, em, 'n' * 22 + '06'); gate('forgot', ip2, em, 'n' * 22 + '07'); gate('forgot', ip2, em, 'n' * 22 + '08')
    check('the inbox limit for password links', gate('forgot', ip, em, 'n' * 22 + '09'), {'verdict': 'rate', 'reasons': ['rate_email']})

    victim = 'v' * 40; ip3 = 'k' * 40; ip4 = 'l' * 40
    for i in range(20):
        gate('sign_in', ip3, victim, None, 'block', 130, ['token_missing'])
        gate('forgot', ip3, victim, None, 'block', 130, ['pow_invalid'])
    # More than the per-email cap across IPs (50): only solved attempts count.
    for i in range(60):
        gate('sign_in', 'p' * 38 + f'{i:02d}', victim, 't' * 22 + f'{i:02d}', 'block', 100, ['turnstile_missing'])
    check('unsolved requests cannot lock someone out of signing in', gate('sign_in', ip4, victim, 's' * 22 + '01')['verdict'], 'allow')
    check('nor out of password links', gate('forgot', ip4, victim, 's' * 22 + '02')['verdict'], 'allow')
    for i in range(8):
        gate('sign_in', ip3, victim, 's' * 22 + f'1{i}')
    check('guessing one password from one IP hits the limit', gate('sign_in', ip3, victim, 's' * 22 + '20'), {'verdict': 'rate', 'reasons': ['rate_email']})
    check('the owner signing in from elsewhere still gets in', gate('sign_in', ip4, victim, 's' * 22 + '21')['verdict'], 'allow')

    cur.execute("select public.antibot_pressure(%s)", (ip,))
    check('stopped attempts raise the pressure on the IP', cur.fetchone()[0], 4)
    cur.execute("insert into public.antibot_events (form, ip_hash, verdict) select 'sign_in', 'm' || lpad(g::text, 39, '0'), 'allow' from generate_series(1, 300) g")
    cur.execute("select public.antibot_pressure(%s)", ('z' * 40,))
    check('a busy site makes everyone\'s challenge harder', cur.fetchone()[0], 3)
    check('but nobody is turned away from signing in', gate('sign_in', 'z' * 40, None, 's' * 22 + '30')['verdict'], 'allow')

    cur.execute("insert into public.antibot_events (form, ip_hash, verdict, reasons) select 'contact', 'q' || lpad(g::text, 39, '0'), 'block', '{token_missing}' from generate_series(1, 100) g")
    check('stopped messages do not count towards the mail cap', gate('contact', 'y' * 40, None, 's' * 22 + '31'), {'verdict': 'allow', 'reasons': []})
    cur.execute("insert into public.antibot_events (form, ip_hash, verdict) select 'contact', 'r' || lpad(g::text, 39, '0'), 'allow' from generate_series(1, 30) g")
    check('past the mail cap a message is kept but its email waits', gate('contact', 'x' * 40, None, 's' * 22 + '32'), {'verdict': 'allow', 'reasons': ['mail_deferred']})
    cur.execute("insert into public.antibot_events (form, ip_hash, verdict) select 'register', 'h' || lpad(g::text, 39, '0'), 'allow' from generate_series(1, 200) g")
    cur.execute("insert into public.antibot_events (form, ip_hash, verdict) select 'forgot', 'h' || lpad(g::text, 39, '0'), 'allow' from generate_series(1, 200) g")
    check('nobody is turned away from registering when the site is busy', gate('register', 'g' * 40, None, 's' * 22 + '33')['verdict'], 'allow')
    check('nor from asking for a password link', gate('forgot', 'g' * 40, 'f' * 40, 's' * 22 + '34')['verdict'], 'allow')

    many = 'w' * 40
    for i in range(19):
        gate('sign_in', 'o' * 38 + f'{i:02d}', many, 'u' * 22 + f'{i:02d}')
    cur.execute("insert into public.antibot_events (form, ip_hash, email_hash, verdict, reasons) select 'sign_in', 'o' || lpad(g::text, 39, '0'), %s, 'rate', '{rate_ip}' from generate_series(1, 30) g", (many,))
    check('rate-limited attempts do not stretch a lock-out', gate('sign_in', 'o' * 38 + '50', many, 'u' * 22 + '50')['verdict'], 'allow')
    check('one account guessed from many IPs is capped at 20', gate('sign_in', 'o' * 38 + '99', many, 'u' * 22 + '99'), {'verdict': 'rate', 'reasons': ['rate_email_spread']})
    owner = 'c' * 40; home = 'd' * 40
    for i in range(8):
        gate('sign_in', home, owner, 'h' * 22 + f'{i:02d}')
        cur.execute("select public.antibot_signed_in(%s)", ('h' * 22 + f'{i:02d}',))
    check('signing in successfully never counts against the owner', gate('sign_in', home, owner, 'h' * 22 + '50')['verdict'], 'allow')
    for i in range(25):
        gate('sign_in', 'e' * 38 + f'{i:02d}', owner, 'g' * 22 + f'{i:02d}')
    check('guessing from many IPs caps strangers', gate('sign_in', 'e' * 38 + '99', owner, 'g' * 22 + '99')['reasons'], ['rate_email_spread'])
    check('but not the owner at home', gate('sign_in', home, owner, 'h' * 22 + '51')['verdict'], 'allow')

    cur.execute("reset role")
    cur.execute("""insert into notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at) values
      ('abtest:contact', 'info@example.com', 'es', 'contact_admin', '{}', 'pending', now() - interval '2 days'),
      ('abtest:order', 'ana@example.com', 'es', 'order_paid_customer', '{}', 'pending', now() - interval '1 minute')""")
    cur.execute("select template_key from public.claim_outbox(1, 60, 'abtest')")
    check('order emails go before notifications to the studio', cur.fetchone()[0], 'order_paid_customer')
    as_role('anon')
    denied('anon cannot report a sign-in', "select public.antibot_signed_in('x')")
    as_role('authenticated', '66666666-6666-4666-8666-666666666666')
    denied('a signed-in visitor cannot report a sign-in', "select public.antibot_signed_in('x')")
    as_role('service_role')

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
    check('the honeypot shows up among the reasons', reasons.get('honeypot', 0) >= 1, True)
    check('the latest stopped attempts are listed, 60 at most', (len(summary['recent']), all(r['verdict'] != 'allow' for r in summary['recent'])), (60, True))
    check('the admin never sees the full hash', all(len(r['ip']) == 8 for r in summary['recent']), True)
finally:
    conn.rollback()
    conn.close()
print(f"{ok} ok, {bad} failed")
sys.exit(1 if bad else 0)
