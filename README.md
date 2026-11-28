# Pets Drawings

The shop and portfolio of the artist Meili Stringfellow at [petsdrawings.com](https://petsdrawings.com/), in English and Spanish.

## Stack

| Part | What |
| --- | --- |
| Site | Astro 7, server-rendered on Vercel (`fra1`), code in `src/` |
| Database | PostgreSQL 18 on Aiven. Data access goes through `src/lib/server/db.ts` (tagged-template SQL; `userDb`/`anonDb` keep row-level security) |
| Schema | `supabase/migrations/*.sql`, applied in order by `scripts/aiven/apply-schema.py` after `supabase/aiven/00_prelude.sql`. The folder name is historical: the site left Supabase on 2026-11-16 |
| Sign-in | Better Auth (`src/lib/server/auth/`), tables in the `auth` schema |
| Images | Cloudinary (`src/lib/server/media/cloudinary.ts`) |
| Payments | Stripe Checkout and PayPal, connected from Admin › Ajustes › Cobros |
| Email | Resend |
| Backups | `.github/workflows/db-backup.yml` runs `scripts/aiven/backup.py` every night |

## Requirements

- Node.js 24 (the Vercel runtime; `engines` allows 22.22+)
- pnpm 10 (the version is pinned in `packageManager`)
- Docker and Python 3 with `psycopg` for a local database

## Run the site

```bash
pnpm install
cp .env.example .env   # fill in what you need, see below
pnpm dev               # http://localhost:4321
```

Without `DATABASE_URL` the site still builds and starts: the shop falls back to the WooCommerce snapshot in `migration/products.json`, and checkout and the forms answer "not configured".

A dev server against a local database needs at least `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SITE_URL` and `ANTIBOT_SECRET`. Use dummy secrets locally, and `EMAIL_ADMIN=delivered@resend.dev` so nothing reaches a real inbox.

Admin lives at `/admin/`. An account is an administrator when it has an active row in `public.admin_users`:

```sql
insert into public.admin_users (user_id, email)
select id, email from auth.users where email = 'someone@example.com';
```

## Local database

```bash
scripts/aiven/local-db.sh up        # PostgreSQL 18 on localhost:55432, prints its URL
LOCAL_PG_URL=postgresql://avnadmin:local@localhost:55432/defaultdb \
  python3 scripts/aiven/apply-schema.py local
scripts/aiven/local-db.sh down
```

The Python scripts read `.env` from the repo root (it may be empty) and take their targets from `scripts/aiven/conn.py`: `local` (`LOCAL_PG_URL`) or `aiven` (`AIVEN_DATABASE_URL` and `AIVEN_CA_CERT_PATH`).

## Schema changes

1. Add a new file to `supabase/migrations/`. Never edit one that is already applied.
2. Check it on the local database: `python3 scripts/aiven/apply-schema.py local`, then the `scripts/sql-check-*.py` that cover it (each runs in one transaction that is rolled back).
3. Apply it to production: `python3 scripts/aiven/apply-schema.py aiven` (`--dry-run` lists what is pending).
4. Regenerate the row types: `python3 scripts/aiven/gen-types.py local`.
5. Confirm production matches the migrations: `python3 scripts/aiven/compare-schema.py local aiven` against a fresh local build. Read only; exits 1 on any difference.

## Tests

| Command | What |
| --- | --- |
| `pnpm test` | Vitest unit tests |
| `TEST_DATABASE_URL=postgresql://… pnpm test` | Also runs `tests/*.integration.test.ts` against a local database (each file's header says what it needs) |
| `pnpm typecheck` | `astro check` |
| `pnpm build` | Production build (Vercel adapter) |
| `DATABASE_URL=postgresql://…localhost… pnpm test:e2e` | Playwright and axe against `astro dev` on port 4323. Refuses to run unless `DATABASE_URL` points to localhost |
| `LOCAL_PG_URL=… python3 scripts/sql-check-<topic>.py` | SQL checks against the local database |

`.github/workflows/ci.yml` runs the unit tests, `astro check` and the build on every push and pull request to `main`.

The Content-Security-Policy (`security.csp` in `astro.config.mjs`) only applies to a build, never in `astro dev`. Astro hashes the scripts and styles it processes; a `<script>` with attributes (such as `is:inline`) is not hashed and is blocked unless its hash is added there, as `StallSketch.astro` does. `tests/csp.test.ts` fails when one appears.

## Other scripts

`pnpm migration:*` are the one-time WooCommerce import tools that built `migration/` and `src/content/`. `scripts/aiven/copy-data.py` and `copy_passwords.py` are the one-time copy from Supabase to Aiven.

## Docs

- `docs/admin-guide.es.md` / `docs/admin-guide.en.md`: the artist's panel
- `docs/commerce-operations.md`: reservations, webhooks, refunds
- `docs/architecture.md`, `docs/vercel-deployment.md`, `docs/launch-checklist.md`: written before the move to Aiven, so they still mention Supabase

## Licence / credit

Artwork © Meili Stringfellow. Site engineering is a new Astro implementation; do not copy prior theme credits as if they authored this stack.
