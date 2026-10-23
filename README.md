# Pets Drawings

Astro 7 rebuild of [petsdrawings.com](https://petsdrawings.com/) — bilingual gallery and shop for Meili Stringfellow, with Supabase, Stripe Checkout, and Vercel.

Spec: `PROMPT_CURSOR_PETSDRAWINGS_ASTRO7.md`. Plan: `docs/plan.md`. Task ledger: `TASKS.md`.

## Requirements

- Node.js **22.22+** or **24.x** (even major; this repo vendors Node 24 under `.tools/` when needed)
- `pnpm` 10.x

```bash
export PATH="$PWD/.tools/node-v24.11.0/bin:$PATH"
pnpm install
cp .env.example .env
pnpm dev
```

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local SSR server |
| `pnpm build` | Production build (Vercel adapter) |
| `pnpm test` | Vitest domain tests |
| `pnpm test:e2e` | Playwright smoke + axe (uses `astro dev`) |
| `pnpm typecheck` / `pnpm lint` | `astro check` |
| `pnpm migration:fetch` | Pull Woo catalog EUR → manifests |
| `pnpm migration:extras` | About / feedbacks / commission examples / logo |
| `pnpm migration:validate` / `pnpm migration:verify` | Assert product/asset counts |
| `pnpm admin:bootstrap` | Link Auth email → `admin_users` (needs service role) |
| `pnpm storage:upload` | Upload `public/media/*` to Supabase Storage |

## Configuration

Fill `.env` from `.env.example`. Without Supabase/Stripe/Resend keys the site still builds: shop falls back to migration manifests; checkout APIs return structured “not configured” responses.

## Docs

- `docs/architecture.md` — rendering, money, checkout states
- `docs/migration-report.md` — source counts and decisions
- `docs/vercel-deployment.md` — env and deploy
- `docs/admin-guide.es.md` / `docs/admin-guide.en.md` — artist panel
- `docs/commerce-operations.md` — reservations, webhooks, refunds
- `docs/qa-report.md` / `docs/launch-checklist.md`

## Licence / credit

Artwork © Meili Stringfellow. Site engineering is a new Astro implementation; do not copy prior theme credits as if they authored this stack.
