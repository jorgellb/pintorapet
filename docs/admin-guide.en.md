# Admin guide (EN)

## Access

1. Invite the artist email in Supabase Auth (no default password in this repo).
2. Set `ADMIN_BOOTSTRAP_EMAIL` and run `pnpm admin:bootstrap` with the service role.
3. Open `/admin/login/` and request a magic link.
4. There is no public admin registration.

## Products

- Edit title, summary and description in **English and Spanish**.
- Attach catalog images; the first is the cover.
- Prices are stored as EUR cents.
- Incomplete drafts are allowed; publishing requires enough copy and images.

## Inventory

- Migrated products start as **availability to confirm** with sales off.
- Enter real stock or confirm made-to-order mode.
- Only then enable sales.

## Orders and commissions

- Shop orders appear after Stripe payment is confirmed via webhook.
- Portrait requests land under Commissions with private files.
