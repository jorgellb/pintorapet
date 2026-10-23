# QA report

Updated as verification runs. Environment: local Node 24 + pnpm.

## Automated

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm test` (domain money/cart) | Pass | 2026-10-21 |
| `pnpm build` | Pass | Astro 7 + Vercel adapter |
| `pnpm typecheck` | Pass | 0 errors |
| `pnpm migration:verify` | Pass | 18 products |
| `pnpm test:e2e` | Pass | smoke EN/ES, axe, cart, work compare/lightbox |
| Site extras C.2–C.5 | Pass | About/feedbacks/examples/logo wired |
| Commerce APIs (code) | Pass build/typecheck | Quote/checkout/webhook/forms/outbox gated by env; no live Stripe/Supabase yet |

## Manual / external pending

- Live Supabase Auth login
- Stripe Checkout end-to-end (test mode)
- Webhook signature verification
- HEIC/PDF conversion quality review (remaining legacy assets)
- Visual pairing review of all Work photo↔drawing pairs on real devices
