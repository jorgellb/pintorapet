# Architecture — Pets Drawings

Astro 7 SSR shop on Vercel, Supabase (Postgres/Auth/Storage), Stripe Checkout, Resend.

## Money

All amounts are **integer euro cents** (`price_cents`, `*_cents` columns). Currency is fixed to `EUR`. No float arithmetic in SQL or application money helpers (`src/lib/domain/money.ts`).

## Shop rendering

Catalog pages are **server-rendered**. The browser cart holds only `{ productId, quantity }` (`src/lib/domain/cart.ts`). Titles, prices, and availability are always revalidated on the server via quote/checkout APIs against Postgres.

Public Data API access is limited to column-scoped views (`catalog_*_v`). Orders, reservations, outbox, Stripe events, and shop settings are not readable by `anon`.

## Reservation flow

1. **Quote** (`create_checkout_quote`) — merges lines, snapshots prices, short TTL; does not reserve stock.
2. **Reserve** (`reserve_checkout`) — locks inventory by `product_id` order, validates sale/inventory, creates pending order + line snapshots + active reservations + checkout attempt; all-or-nothing.
3. **Stripe session** (outside the DB transaction) — then `attach_stripe_session`.
4. **Webhook** — `apply_payment` consumes reservations once (or marks `review` if paid without a usable reservation). Cancel/expire uses `release_reservations` only after Stripe confirms it is safe.
5. **Outbox** — `claim_outbox` leases notification rows with `FOR UPDATE SKIP LOCKED`.

Sales stay off until inventory is verified (`inventory_mode` defaults to `unverified`; `shop_settings.sales_enabled` / `payments_enabled` default false).

## Environment variables

| Variable | Role |
| --- | --- |
| `SITE_URL` / `PUBLIC_SITE_URL` | Canonical origin for callbacks and returns |
| `PUBLIC_SUPABASE_URL` | Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Publishable key (RLS + views) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; calls privileged commerce RPCs |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `PUBLIC_STRIPE_PUBLISHABLE_KEY` | Checkout + webhook |
| `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_ADMIN` | Transactional email |
| `CHECKOUT_QUOTE_TTL_SECONDS` / `CHECKOUT_RESERVATION_MINUTES` | Quote/reservation windows |
| `CART_MAX_QTY_PER_LINE` / `CART_MAX_LINES` / `CART_MAX_UNITS` | Cart limits |
| `CRON_SECRET` | Authorizes internal jobs |
| `ADMIN_BOOTSTRAP_EMAIL` | Bootstrap script only (no default password) |

See `.env.example` for the full template. Migrations live under `supabase/migrations/` (including Storage buckets in `20261022000000_storage_buckets.sql`); seed only categories and shop settings (`supabase/seed.sql`).

Admin product edits use the authenticated Supabase user client + RLS (`is_admin()`). Inventory changes go through `adjust_inventory`. Bootstrap membership with `pnpm admin:bootstrap`; upload local media with `pnpm storage:upload`.
