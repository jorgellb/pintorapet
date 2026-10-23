# Launch checklist

## Before enabling sales

- [ ] Supabase project linked; migrations applied; buckets created
- [ ] Stripe live keys + webhook endpoint verified
- [ ] Resend domain verified; sample emails EN/ES received
- [ ] Real stock entered (or made-to-order confirmed) per product
- [ ] `sale_enabled` only for verified inventory
- [ ] Legal pages reviewed by owner (privacy, cookies, terms, shipping)
- [ ] Shipping rates / tax stance configured in `shop_settings`
- [ ] Admin user bootstrapped; password recovery tested
- [ ] Redirects from WordPress URLs verified
- [ ] Mobile + desktop pass on home, work, shop, cart, checkout return
- [ ] `pnpm build` green; Playwright smoke on staging
- [ ] Cron/secret for reservation cleanup configured

## Do not claim production-ready until

Sales keys, stock verification, and legal review are complete.
