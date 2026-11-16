#!/usr/bin/env python3
"""Build the schema on a plain PostgreSQL: supabase/aiven/00_prelude.sql, then
every supabase/migrations/*.sql not yet recorded in ops.schema_migrations, in
order, each in its own transaction. Stops at the first failure.

Usage:
  python3 scripts/aiven/apply-schema.py local  [--dry-run]   # Docker, see scripts/aiven/local-db.sh
  python3 scripts/aiven/apply-schema.py aiven  [--dry-run]   # AIVEN_DATABASE_URL + AIVEN_CA_CERT_PATH
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conn import connect  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PRELUDE = ROOT / 'supabase' / 'aiven' / '00_prelude.sql'
MIGRATIONS = sorted((ROOT / 'supabase' / 'migrations').glob('*.sql'))


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    dry = '--dry-run' in sys.argv
    with connect(target) as conn:
        conn.execute(PRELUDE.read_text())
        conn.commit()
        done = {row[0] for row in conn.execute('SELECT version FROM ops.schema_migrations')}
        pending = [path for path in MIGRATIONS if path.stem not in done]
        print(f'{target}: {len(done)} applied, {len(pending)} pending')
        for path in pending:
            if dry:
                print(f'  would apply {path.name}')
                continue
            try:
                conn.execute(path.read_text())
                conn.execute('INSERT INTO ops.schema_migrations (version) VALUES (%s)', (path.stem,))
                conn.commit()
                print(f'  applied {path.name}')
            except Exception as exc:
                conn.rollback()
                print(f'  FAILED {path.name}: {exc}')
                sys.exit(1)


if __name__ == '__main__':
    main()
