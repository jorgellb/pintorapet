#!/usr/bin/env python3
"""Apply one SQL migration to the Supabase database in a single transaction.

Usage: python3 scripts/apply-migration.py supabase/migrations/<file>.sql [--dry-run]
Reads SUPABASE_DB_POOLER, SUPABASE_DB_POOLER_USER and SUPABASE_DB_PASSWORD from .env.
With --dry-run the migration runs and is rolled back.
"""
import sys
import psycopg

def env():
    out = {}
    for line in open('.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k] = v.strip().strip('"').strip("'")
    return out

path = sys.argv[1]
dry = '--dry-run' in sys.argv
e = env()
conn = psycopg.connect(host=e['SUPABASE_DB_POOLER'], port=5432, user=e['SUPABASE_DB_POOLER_USER'],
                       password=e['SUPABASE_DB_PASSWORD'], dbname='postgres', sslmode='require')
try:
    conn.execute(open(path).read())
    if dry:
        conn.rollback(); print(f'{path}: ran and ROLLED BACK (dry run)')
    else:
        conn.commit(); print(f'{path}: COMMITTED')
except Exception as ex:
    conn.rollback(); print(f'{path}: ERROR {ex}'); sys.exit(1)
