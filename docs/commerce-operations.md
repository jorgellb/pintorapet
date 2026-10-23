# Commerce operations

## Money

All amounts are integer EUR cents. Never trust client-supplied prices.

## Flow

1. Browser cart stores only `{ productId, quantity }` plus an opaque `pd_cart_owner` cookie (hashed server-side).
2. `POST /api/cart/quote` builds a server quote via `create_checkout_quote` when `SUPABASE_SERVICE_ROLE_KEY` is set; otherwise returns a non-persistent manifest quote.
3. `POST /api/checkout/create` calls `reserve_checkout`, creates a Stripe Checkout Session with idempotency, then `attach_stripe_session`.
4. Webhook `/api/webhooks/stripe` verifies the signature, then `apply_payment` or `release_reservations`.
5. Forms (`/api/contact`, `/api/commissions`) persist rows and enqueue `notification_outbox`; `POST /api/cron/outbox` (Bearer `CRON_SECRET`) leases and sends via Resend.

Sales stay off until `shop_settings.sales_enabled` / `payments_enabled` and verified inventory — `reserve_checkout` raises `SALES_DISABLED` / `INVENTORY_UNVERIFIED` otherwise.

## SQL functions

Defined in `supabase/migrations/20261021000002_commerce_fns.sql` — apply in Supabase before enabling sales.

## Investigation

- Stuck `checkout_attempts` → admin review; do not release stock on unknown Stripe timeouts.
- Duplicate webhooks → `stripe_events.event_id` uniqueness.
- Refunds → Stripe dashboard + inventory adjust with audit log.
