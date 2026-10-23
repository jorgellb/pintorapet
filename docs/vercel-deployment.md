# Vercel deployment

## Prerequisites

1. Supabase project with migrations applied (`supabase/migrations/*`) and seed.
2. Stripe account (test then live) + webhook to `/api/webhooks/stripe`.
3. Resend domain for transactional mail.
4. Environment variables from `.env.example` in Vercel Project Settings.

## Project settings

- Framework: Astro
- Build: `pnpm build`
- Output: Vercel adapter (`@astrojs/vercel`)
- Node.js: **24.x** (or 22.22+)
- Install: `pnpm install`

## Domains

Point `petsdrawings.com` to Vercel after DNS cutover. Keep WordPress redirects from `migration/redirects.json` in `vercel.json` or middleware.

## Cron

Configure a Vercel Cron (or external caller) for:

- `POST /api/cron/outbox` with header `Authorization: Bearer $CRON_SECRET`

Suggested schedule: every 5 minutes.

## Post-deploy

1. Insert the artist into `admin_users` (Auth user id + email). Magic-link login is at `/admin/login/` — no default password.
2. Confirm webhook deliveries in Stripe dashboard (`/api/webhooks/stripe`).
3. Run launch checklist (`docs/launch-checklist.md`).
