#!/usr/bin/env python3
"""Compare the public schema of two PostgreSQL databases: columns, functions
(by source), RLS policies, triggers, indexes, views, and table/function
privileges for anon and authenticated. Read only.

Each side is a conn.py target (local, aiven) or, for a second throwaway
database, a postgresql:// URL on localhost. The usual check is a fresh local
build of the migrations against production:

  scripts/aiven/local-db.sh up
  LOCAL_PG_URL=... python3 scripts/aiven/apply-schema.py local
  LOCAL_PG_URL=... python3 scripts/aiven/compare-schema.py local aiven

Usage: python3 scripts/aiven/compare-schema.py <a> <b>
Exit 1 when anything differs.
"""
import sys
from pathlib import Path
from urllib.parse import urlsplit

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conn import connect  # noqa: E402

QUERIES = {
    'columns': """
      SELECT table_name || '.' || column_name,
             data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '')
      FROM information_schema.columns WHERE table_schema = 'public'""",
    'functions': """
      SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             md5(p.prosrc) || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'""",
    'policies': """
      SELECT tablename || '.' || policyname,
             cmd || ' ' || array_to_string(roles, ',') || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
      FROM pg_policies WHERE schemaname = 'public'""",
    'rls': """
      SELECT c.relname, c.relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'""",
    'triggers': """
      SELECT event_object_table || '.' || trigger_name || '.' || event_manipulation, action_timing || ' ' || action_statement
      FROM information_schema.triggers WHERE trigger_schema = 'public'""",
    'indexes': "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
    'views': "SELECT viewname, md5(definition) FROM pg_views WHERE schemaname = 'public'",
    'table_grants': """
      SELECT table_name || ' ' || grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') GROUP BY 1""",
    'function_grants': """
      SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || r.rolname,
             has_function_privilege(r.oid, p.oid, 'EXECUTE')::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN pg_roles r
      WHERE n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated')""",
}

LOOPBACK = {'localhost', '127.0.0.1', '::1'}


def open_target(target: str) -> tuple[str, psycopg.Connection]:
    """A connection and a printable name (never the password)."""
    if '://' not in target:
        return target, connect(target)
    url = urlsplit(target)
    if url.hostname not in LOOPBACK:
        raise SystemExit('only localhost URLs are accepted; use the aiven target for production')
    return f'{url.hostname}:{url.port or 5432}{url.path}', psycopg.connect(target)


def snapshot(target: str) -> tuple[str, dict]:
    name, conn = open_target(target)
    with conn:
        conn.read_only = True
        return name, {query: dict(conn.execute(sql).fetchall()) for query, sql in QUERIES.items()}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    (name_a, a_all), (name_b, b_all) = snapshot(sys.argv[1]), snapshot(sys.argv[2])
    if name_a == name_b:
        name_a, name_b = f'{name_a} (a)', f'{name_b} (b)'
    differences = 0
    for query in QUERIES:
        a, b = a_all[query], b_all[query]
        only_a = sorted(set(a) - set(b))
        only_b = sorted(set(b) - set(a))
        changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
        status = 'same' if not (only_a or only_b or changed) else 'DIFFERENT'
        print(f'{query:16} {len(a):4} vs {len(b):4}  {status}')
        for key in only_a[:8]:
            print(f'    only in {name_a}: {key}')
        for key in only_b[:8]:
            print(f'    only in {name_b}: {key}')
        for key in changed[:8]:
            print(f'    changed: {key}\n      {name_a}: {a[key][:160]}\n      {name_b}: {b[key][:160]}')
        differences += len(only_a) + len(only_b) + len(changed)
    print(f'{name_a} vs {name_b}: {"no differences" if not differences else f"{differences} differences"}')
    sys.exit(1 if differences else 0)


if __name__ == '__main__':
    main()
