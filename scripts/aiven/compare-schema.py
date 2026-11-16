#!/usr/bin/env python3
"""Compare the public schema of Supabase (source) with a target built by
apply-schema.py: columns, functions (by source), RLS policies, triggers,
indexes, views, and table/function privileges for anon and authenticated.

Usage: python3 scripts/aiven/compare-schema.py local|aiven
Exit 1 when anything differs.
"""
import hashlib
import sys
from pathlib import Path

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


def snapshot(target: str) -> dict:
    with connect(target) as conn:
        conn.read_only = True
        return {name: dict(conn.execute(sql).fetchall()) for name, sql in QUERIES.items()}


def main() -> None:
    target = sys.argv[1]
    source, dest = snapshot('supabase'), snapshot(target)
    differences = 0
    for name in QUERIES:
        a, b = source[name], dest[name]
        only_a = sorted(set(a) - set(b))
        only_b = sorted(set(b) - set(a))
        changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
        status = 'same' if not (only_a or only_b or changed) else 'DIFFERENT'
        print(f'{name:16} {len(a):4} vs {len(b):4}  {status}')
        for key in only_a[:8]:
            print(f'    only in supabase: {key}')
        for key in only_b[:8]:
            print(f'    only in {target}: {key}')
        for key in changed[:8]:
            print(f'    changed: {key}\n      supabase: {a[key][:160]}\n      {target}: {b[key][:160]}')
        differences += len(only_a) + len(only_b) + len(changed)
    sys.exit(1 if differences else 0)


if __name__ == '__main__':
    main()
