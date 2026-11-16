#!/usr/bin/env python3
"""Bring the Supabase Auth passwords over as Better Auth password accounts.

Supabase kept a bcrypt hash per user (auth.users.encrypted_password); Better
Auth keeps it in auth.account (provider 'credential', account_id = user id).
src/lib/server/auth/password.ts checks those hashes with pgcrypto, so the old
passwords keep working. The hash is copied as is: no password is ever seen.

Safe to run again: it only adds an account for a user that exists on the target
and has none yet; a password chosen since the move is never overwritten.

Usage: python3 scripts/aiven/copy_passwords.py local|aiven
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conn import connect  # noqa: E402

SUPABASE_PASSWORDS = """
  SELECT id, encrypted_password FROM auth.users
  WHERE deleted_at IS NULL AND email IS NOT NULL AND coalesce(encrypted_password, '') <> ''"""

INSERT_ACCOUNT = """
  INSERT INTO auth.account (account_id, provider_id, user_id, password)
  SELECT u.id::text, 'credential', u.id, %(hash)s FROM auth.users u
  WHERE u.id = %(id)s
    AND NOT EXISTS (SELECT 1 FROM auth.account a WHERE a.user_id = u.id AND a.provider_id = 'credential')"""


def copy_passwords(src, dst) -> tuple[int, int]:
    """Returns (passwords in Supabase, accounts added on the target)."""
    rows = src.execute(SUPABASE_PASSWORDS).fetchall()
    added = 0
    with dst.cursor() as cur:
        for user_id, hash_ in rows:
            if not hash_.startswith('$2a$'):
                raise SystemExit(f'user {user_id}: unexpected hash format {hash_[:4]!r}')
            cur.execute(INSERT_ACCOUNT, {'id': user_id, 'hash': hash_})
            added += cur.rowcount
    return len(rows), added


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ('local', 'aiven'):
        raise SystemExit(__doc__)
    with connect('supabase') as src, connect(sys.argv[1]) as dst:
        src.read_only = True
        found, added = copy_passwords(src, dst)
        dst.commit()
        total = dst.execute("SELECT count(*) FROM auth.account WHERE provider_id = 'credential'").fetchone()[0]
    print(f'passwords in Supabase: {found}; accounts added: {added}; password accounts now: {total}')


if __name__ == '__main__':
    main()
