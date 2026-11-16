#!/usr/bin/env python3
"""Copy the data from Supabase into a target built by apply-schema.py.

  1. auth.users (ids kept; Supabase columns mapped to Better Auth's), and
     their passwords as Better Auth password accounts (copy_passwords.py)
  2. every public table, in foreign-key order, with COPY. The target's rows
     (seeds the migrations insert) are replaced; user triggers are off while
     loading, so invoice numbering or "issued invoices are immutable" rules do
     not rewrite or reject history.
  3. sequences set to the source's values
  4. vault secrets: decrypted from Supabase, sealed again with VAULT_KEY
  5. check: same row count and same checksum per table on both sides

Usage: python3 scripts/aiven/copy-data.py local|aiven [--replace]
Without --replace it refuses a target that already has orders.
"""
import sys
from pathlib import Path

from psycopg import sql
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conn import connect, env  # noqa: E402
from copy_passwords import copy_passwords  # noqa: E402

AUTH_USERS = """
  SELECT id, email,
         coalesce(nullif(raw_user_meta_data->>'full_name', ''), split_part(email, '@', 1)) AS name,
         email_confirmed_at IS NOT NULL AS email_verified,
         created_at, coalesce(updated_at, created_at) AS updated_at,
         email_confirmed_at, last_sign_in_at, coalesce(raw_user_meta_data, '{}'::jsonb) AS raw_user_meta_data
  FROM auth.users WHERE deleted_at IS NULL AND email IS NOT NULL"""


def public_tables_in_fk_order(conn) -> list[str]:
    tables = [r[0] for r in conn.execute("""
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1""")]
    deps = {t: set() for t in tables}
    for child, parent in conn.execute("""
        SELECT cl.relname, pl.relname FROM pg_constraint k
        JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = cl.relnamespace
        JOIN pg_class pl ON pl.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = pl.relnamespace
        WHERE k.contype = 'f' AND cn.nspname = 'public' AND pn.nspname = 'public'"""):
        if child != parent:
            deps[child].add(parent)
    ordered, placed = [], set()
    while len(ordered) < len(tables):
        ready = [t for t in tables if t not in placed and deps[t] <= placed]
        if not ready:
            raise SystemExit(f'foreign-key cycle among: {sorted(set(tables) - placed)}')
        ordered.extend(ready)
        placed.update(ready)
    return ordered


def copy_columns(conn, table: str) -> list[str]:
    return [r[0] for r in conn.execute("""
        SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        ORDER BY a.attnum""", (f'public.{table}',))]


def qualified(table: str) -> sql.Identifier:
    return sql.Identifier('public', table)


# Static SQL; the table name is a parameter and is quoted server-side (%I).
# Rows are hashed and sorted with COLLATE "C": two servers can sort text
# differently under the same locale name (glibc versions).
CHECKSUM = """
  SELECT (xpath('/row/n/text()', x))[1]::text::bigint, coalesce((xpath('/row/h/text()', x))[1]::text, '')
  FROM query_to_xml(
    format('SELECT count(*) AS n, md5(string_agg(r, %%L ORDER BY r COLLATE "C")) AS h
            FROM (SELECT md5(t::text) AS r FROM public.%%I t) x', '|', %s::text),
    false, true, '') AS x"""

# ALTER TABLE ... DISABLE/ENABLE TRIGGER USER on every public table.
SET_USER_TRIGGERS = """
  DO $$
  DECLARE t text;
  BEGIN
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r' LOOP
      EXECUTE format('ALTER TABLE public.%I {} TRIGGER USER', t);
    END LOOP;
  END $$"""
DISABLE_TRIGGERS = SET_USER_TRIGGERS.replace('{}', 'DISABLE')
ENABLE_TRIGGERS = SET_USER_TRIGGERS.replace('{}', 'ENABLE')

TRUNCATE_PUBLIC = """
  DO $$
  BEGIN
    EXECUTE (SELECT 'TRUNCATE ' || string_agg(format('public.%I', c.relname), ', ') || ' RESTART IDENTITY CASCADE'
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r');
  END $$"""


def checksum(conn, table: str) -> tuple[int, str]:
    return conn.execute(CHECKSUM, (table,)).fetchone()


def main() -> None:
    target = sys.argv[1]
    replace = '--replace' in sys.argv
    vault_key = env().get('VAULT_KEY')
    if not vault_key:
        raise SystemExit('VAULT_KEY is missing in .env')

    # autocommit: dst.transaction() below is then a real BEGIN/COMMIT, not a
    # savepoint inside an implicit transaction that would be rolled back on exit.
    with connect('supabase') as src, connect(target, autocommit=True) as dst:
        src.read_only = True
        for conn in (src, dst):
            conn.execute("SET TimeZone = 'UTC'")
            conn.execute('SET extra_float_digits = 3')
        if not replace and dst.execute('SELECT count(*) FROM public.orders').fetchone()[0]:
            raise SystemExit(f'{target} already has orders; pass --replace to overwrite it')

        tables = public_tables_in_fk_order(dst)
        with dst.transaction():
            dst.execute(TRUNCATE_PUBLIC)
            dst.execute('DELETE FROM auth.users')
            dst.execute('DELETE FROM vault.secrets')
            dst.execute(DISABLE_TRIGGERS)

            # 1. users
            users = [(*row[:8], Jsonb(row[8])) for row in src.execute(AUTH_USERS).fetchall()]
            with dst.cursor() as cur:
                cur.executemany("""
                    INSERT INTO auth.users (id, email, name, email_verified, created_at, updated_at,
                                            email_confirmed_at, last_sign_in_at, raw_user_meta_data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""", users)
            print(f'auth.users: {len(users)}')
            print('password accounts: {1} of {0}'.format(*copy_passwords(src, dst)))

            # 2. tables
            for t in tables:
                cols = sql.SQL(', ').join(sql.Identifier(c) for c in copy_columns(dst, t))
                read = sql.SQL('COPY (SELECT {} FROM {}) TO STDOUT').format(cols, qualified(t))
                write = sql.SQL('COPY {} ({}) FROM STDIN').format(qualified(t), cols)
                with src.cursor().copy(read) as out, dst.cursor().copy(write) as inp:
                    for chunk in out:
                        inp.write(chunk)

            # 3. sequences
            for seq, last, called in src.execute("""
                SELECT schemaname || '.' || sequencename, last_value, last_value IS NOT NULL
                FROM pg_sequences WHERE schemaname = 'public'"""):
                if last is not None:
                    dst.execute('SELECT setval(%s, %s, %s)', (seq, last, called))

            # 4. secrets
            dst.execute("SELECT set_config('app.vault_key', %s, true)", (vault_key,))
            secrets = src.execute('SELECT name, decrypted_secret, description FROM vault.decrypted_secrets').fetchall()
            for name, value, description in secrets:
                dst.execute('SELECT vault.create_secret(%s, %s, %s)', (value, name, description or ''))
            print(f'vault secrets: {len(secrets)}')

            dst.execute(ENABLE_TRIGGERS)

    # 5. check, on a fresh connection so only committed rows count
    bad = 0
    with connect('supabase') as src, connect(target) as dst:
        src.read_only = True
        for conn in (src, dst):
            conn.execute("SET TimeZone = 'UTC'")
            conn.execute('SET extra_float_digits = 3')
        for t in tables:
            a, b = checksum(src, t), checksum(dst, t)
            if a != b:
                bad += 1
                print(f'  MISMATCH {t}: supabase {a[0]} rows, {target} {b[0]} rows')
        users = dst.execute('SELECT count(*) FROM auth.users').fetchone()[0]
        sealed = dst.execute('SELECT count(*) FROM vault.secrets').fetchone()[0]
    print(f'tables: {len(tables)} copied, {len(tables) - bad} identical, {bad} different'
          f' | committed: {users} users, {sealed} secrets')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
