"""Connections for the Aiven migration scripts.

  local    LOCAL_PG_URL: the Docker PostgreSQL 18 from scripts/aiven/local-db.sh,
           connected as a non-superuser `avnadmin` like Aiven's
  aiven    AIVEN_DATABASE_URL, TLS verified with AIVEN_CA_CERT_PATH
  supabase the source, over the direct pooler connection (SUPABASE_DB_*)
"""
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]


def env() -> dict:
    out = {}
    for line in (ROOT / '.env').read_text().splitlines():
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            out[key.strip()] = value.strip().strip('"').strip("'")
    return {**out, **{k: v for k, v in os.environ.items() if k in out or k == 'LOCAL_PG_URL'}}


def connect(target: str, **kwargs) -> psycopg.Connection:
    e = env()
    if target == 'local':
        if not e.get('LOCAL_PG_URL'):
            raise SystemExit('LOCAL_PG_URL is not set (see scripts/aiven/local-db.sh)')
        return psycopg.connect(e['LOCAL_PG_URL'], **kwargs)
    if target == 'aiven':
        return psycopg.connect(e['AIVEN_DATABASE_URL'], sslmode='verify-full',
                               sslrootcert=str(ROOT / e['AIVEN_CA_CERT_PATH']), connect_timeout=15, **kwargs)
    if target == 'supabase':
        return psycopg.connect(host=e['SUPABASE_DB_POOLER'], port=5432, user=e['SUPABASE_DB_POOLER_USER'],
                               password=e['SUPABASE_DB_PASSWORD'], dbname='postgres', sslmode='require',
                               connect_timeout=15, **kwargs)
    raise SystemExit(f'unknown target {target!r}: use local, aiven or supabase')
