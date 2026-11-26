# Clientes sin cuenta: editar y borrar datos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can edit a guest customer's contact details across their orders, and can anonymize a guest's (or a deleted account's) personal data while keeping orders and invoices.

**Architecture:** SQL functions do the edit and the anonymization in one transaction each, run with the service role from admin-only routes. TypeScript wraps them, purges the review photos from Cloudinary afterwards, and adds the guest record page, the edit form, the delete dialog, and the «Borrar también sus datos de los pedidos» checkbox on account deletion.

**Tech Stack:** Astro 7 SSR, Aiven PostgreSQL, zod, vitest, Playwright, Python SQL checks.

**Spec:** `docs/superpowers/specs/2026-11-26-clientes-sin-cuenta-design.md`

## Global Constraints

- A guest is identified as the orders with `customer_id is null` sharing `lower(trim(customer_email))`. Its key is the sha256 hex of that value, and the email never goes in a URL.
- Anonymizing is refused while any of those orders is still due:
  - payment `pending_session`, `checkout_open`, `processing`, `awaiting_transfer` or `review`;
  - or paid and fulfillment not in `shipped`, `delivered`, `completed`, `cancelled`.
- Anonymized order: `customer_name='Cliente borrado'`, `customer_email=null`, `shipping_address={country, postal_code}` only, `gift_message=null`, `is_gift=false`. `invoice_customer` is kept only when a full invoice exists for the order; otherwise it is null.
- Anonymizing also clears:
  - `checkout_attempts.stripe_payload` of those orders becomes null;
  - `notification_outbox` rows for that recipient are deleted;
  - `coupon_redemptions.email/payer_email` become null;
  - the reviews of those orders are deleted, with their photos.
- Invoices are never touched.
- The audit line records the count only, with no email or name.
- Admin copy is in Spanish. Never edit applied migrations; the new one is `supabase/migrations/20261126000012_guest_customers.sql`.
- Tests send no real emails, delete any Cloudinary test uploads, use a local Docker DB, and delete throwaway specs.
- Work on an isolated branch. Squash it into one commit on main at the end and push; Jorge approved.

## Review Focus

- **Order that has a full invoice:** it keeps `invoice_customer` and the invoice is unchanged. Pinned in Task 1, `an invoiced order keeps its invoice data and invoice row`.
- **Edit to an email that belongs to an account:** refused. Pinned in Task 1, `edit to an account's email is refused`.
- **Guest with a pending order:** delete is refused and names the reference. Pinned in Task 1, `pending order blocks anonymizing`.
- **Email case and spaces:** `Ana@X.com ` and `ana@x.com` count as one guest. Pinned in Task 1, `case and spaces are one guest`.
- **A review photo destroy that fails:** the review is already gone from the web, and Admin shows a warning. Pinned in Task 2, `a Cloudinary failure after anonymizing is reported, data stays anonymized`.

---

### Task 1: SQL — guest key, edit, anonymize

**Files:**
- Create: `supabase/migrations/20261126000012_guest_customers.sql`
- Create: `scripts/sql-check-guest-customers.py`, using the same harness as `scripts/sql-check-reviews.py`.

**Produces (all `SECURITY DEFINER`, `SET search_path = pg_catalog, public, extensions`, execute granted to service_role only):**
- `public.guest_key(p_email text) returns text` (immutable): `encode(digest(lower(btrim(p_email)), 'sha256'), 'hex')`.
- `public.admin_guest_customer(p_key text) returns jsonb`. Returns `null` when there are no orders. Otherwise:
  - `{ key, email, full_name, phone, orders: [{id, reference, created_at, payment_status, fulfillment_status, total_cents}], spent_cents, contact_messages: int, commission_requests: int }`
  - `full_name` and `phone` come from the latest order, and `phone` from `shipping_address->>'phone'`.
  - `spent_cents` counts paid, partially refunded, refunded and review orders, as `admin_customer` does in `20261026000002_admin_customers.sql`.
- `public.admin_guest_update(p_key text, p_full_name text, p_email text, p_phone text) returns jsonb`. Returns `{ key, merged: boolean, orders: int }`.
  - Validates the name (1–120 characters), the email format, and the phone (at most 32 characters).
  - Refuses with `GUEST_EMAIL_IS_ACCOUNT` when the new email belongs to `auth.users`.
  - Updates every guest order of that key: `customer_name`, `customer_email` (lower/trimmed), `shipping_address.phone`, and `shipping_address.name` when it equalled the old name.
  - `merged` is true when the new key already had other guest orders.
- `public.guest_due_orders(p_order_ids uuid[]) returns text[]`: the references of the given orders that are still due, using the rule in Global Constraints.
- `public.anonymize_orders(p_order_ids uuid[], p_email text) returns jsonb`. Returns `{ orders: int, review_ids: uuid[] }`.
  - Raises `CUSTOMER_HAS_DUE_ORDERS: <refs>` when `guest_due_orders` is not empty.
  - Otherwise applies every rule in Global Constraints, except that it **returns** the review ids instead of deleting them. TypeScript deletes those reviews and their photos.
- `public.admin_guest_anonymize(p_key text) returns jsonb`: collects the guest's orders, then calls `anonymize_orders(ids, email)`.
- `public.admin_account_order_ids(p_user_id uuid) returns uuid[]`: the account's orders, plus guest orders with the account's email. Used by the account-deletion checkbox before the auth user is deleted.

**Steps:**
- [ ] **Step 1: write the failing checks.** Seed two guests and an account. Each guest gets a shipped paid order and an unpaid one, and one order has a full invoice. Checks:
  - `case and spaces are one guest`
  - `admin_guest_customer lists orders and spent`
  - `edit renames, re-emails and re-phones all guest orders`
  - `edit to another guest's email merges`
  - `edit to an account's email is refused`
  - `pending order blocks anonymizing` (the message has the reference)
  - after the pending order is cancelled, `anonymize clears name/email/address/gift, keeps country+postal`
  - `an invoiced order keeps its invoice data and invoice row` (the invoice row is byte-identical)
  - `stripe_payload nulled`
  - `outbox rows for the email deleted`
  - `coupon redemption emails nulled`
  - `returns the order's review ids`
  - `anon/authenticated cannot execute`
- [ ] **Step 2: run it on a fresh local DB and see it FAIL.**
- [ ] **Step 3: implement.**
- [ ] **Step 4: run it plus all the existing SQL checks** (reviews, coupons, commission-payments, manual-orders, markets, pickup) **and see them all OK.**
- [ ] **Step 5: commit** with the message "Guest customers: key, edit, anonymize in SQL."

### Task 2: Server, routes and Admin UI

**Files:**
- Modify: `src/lib/server/admin/customers.ts`
  - `getGuest(service, key)`
  - `updateGuest(service, key, input)`
  - `anonymizeGuest(service, key): Promise<{ orders: number; warning?: string }>`
  - `anonymizeAccountOrders(service, userId)`. It calls `admin_account_order_ids` before deletion and `anonymize_orders` after.
  - The anonymize functions then call `deleteReview(db(), id)` for each returned review id, from `src/lib/server/reviews/store.ts`, collecting failures into `warning`, and call `forgetReviews()`.
- Create:
  - `src/pages/admin/customers/guest/[key].astro`
  - `src/pages/api/admin/customers/guest/[key].ts`: PATCH edits the contact, DELETE anonymizes. Both use `requireAdmin`, check that the key matches `^[0-9a-f]{64}$`, and call `audit` with the count only.
- Modify:
  - `src/pages/admin/customers/index.astro`: a guest's name links to `/admin/customers/guest/<key>/`, with the key computed server-side the same way as `guest_key`.
  - `src/pages/admin/customers/[id].astro` together with `src/pages/api/admin/customers/[id]/index.ts`: the DELETE takes `{ alsoOrders: boolean }`. When true, it checks the due orders first (409 with the references), then deletes the account, then anonymizes. The page adds the checkbox «Borrar también sus datos de los pedidos», unchecked by default.
  - `src/lib/server/commerce/pgErrors.ts`: `GUEST_EMAIL_IS_ACCOUNT` returns 409 «Ese email es de un cliente con cuenta: usa su ficha.», and `CUSTOMER_HAS_DUE_ORDERS` returns 409 «Tiene pedidos pendientes de cobrar o de enviar: …» followed by the references.
- Test: `tests/guestCustomers.test.ts`.

**Steps:**
- [ ] **Step 1: write the failing vitest.**
  - `key is sha256 of lower(trim(email))`, matching `guest_key`.
  - `anonymizeGuest deletes the returned reviews and forgets the cache`.
  - `a Cloudinary failure after anonymizing is reported, data stays anonymized`, with `deleteReview` rejecting.
  - `account delete with alsoOrders refuses due orders before deleting the account`.
  - `routes are admin-only and reject a bad key`.
- [ ] **Step 2: run it and see it FAIL.**
- [ ] **Step 3: build the server code, the routes and the pages.**
  - Guest record page:
    - contact form: name, email and phone;
    - list of orders;
    - notice and links for contact messages and commission requests;
    - a «Borrar sus datos» panel with the exact spec copy about invoices, behind a `confirm()` that lists what is erased and what is kept.
  - After anonymizing, the page redirects to the list with a status line.
  - Follow `src/pages/admin/customers/[id].astro` and `src/components/admin/CustomerForm.astro` for layout and styles.
- [ ] **Step 4: check it with the throwaway `e2e/zz-guest-customers.spec.ts`** on a local server: edit, merge warning, refused delete because of a due order, a successful delete, and account delete with the checkbox. Take screenshots at 1280 and 390, then delete the spec. Run vitest and astro check.
- [ ] **Step 5: commit** with the message "Admin: edit and erase guest customers."

### Task 3: Production
- [ ] Run every check locally.
- [ ] Compare the production body of any existing function the migration replaces. None are expected.
- [ ] Run the Aiven dry run, apply, generate types, and run the SQL checks on Aiven.
- [ ] Squash, push, update the main checkout, and report in Spanish.
