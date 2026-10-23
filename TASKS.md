# Registro de tareas — Pets Drawings

Actualizar estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho · `[!]` bloqueado externo

## Fase 0 — Coordinación
- [x] Plan breve (`docs/plan.md`)
- [x] Scaffold Astro 7 + lockfile (`astro@7.4.2`, pnpm)
- [x] Contratos: `src/i18n/*`, `src/lib/domain/*`, tokens CSS
- [x] `.env.example`, `.gitignore`, engines Node

## Fase 1 — Migración
- [x] `scripts/migration/` crawl + download + hash
- [x] Snapshot WC Store EUR + validación precios (18/18)
- [x] `migration/products.json` + `assets.json` (47/47) + UUIDs
- [x] `migration/redirects.json`
- [x] `migration/report.md` / `docs/migration-report.md`
- [x] `migration/artworks.json` (19 grupos Anexo B)
- [x] `migration/pages.json` (about/contact/commissions/gallery/work EN+ES)
- [x] `migration/gallery-extra.json` (Anexo C.1) + HEIC Mojácar → JPEG
- [x] `pnpm migration:publish-media` → `public/media/catalog` (47)
- [x] Script `pnpm storage:upload` (+ migración buckets) — ejecución real `[!]` env
- [ ] Subida ejecutada en proyecto Supabase real `[!]`
- [x] Mojácar HEIC → JPEG publicado (`public/media/gallery/mojacar-0.jpg`)
- [ ] Más HEIC/PDF del portfolio antiguo si hacen falta (resto)

## Fase 2 — Contenido y diseño
- [x] Colecciones Astro content (work + gallery)
- [x] PublicLayout, nav, footer, design tokens
- [x] Páginas públicas EN/ES
- [x] Shop/ficha/home/work con imágenes reales
- [x] About/Contact/Commissions/Gallery con copy migrado
- [x] Fuentes locales Bodoni Moda + Manrope (`@fontsource`, latin-ext)
- [x] Feedbacks (3 reseñas Anexo C.4) en Contact
- [x] About images Anexo C.2
- [x] Ejemplos encargos C.3 (Kira/Sox + Frankie) + logo C.5
- [x] `pnpm migration:extras` → `migration/site-extras.json` + `public/media/{about,feedbacks,…}`

## Fase 3 — Datos
- [x] `supabase/migrations/` + seed + `products_from_migration.sql`
- [x] `docs/architecture.md`
- [ ] Aplicar migraciones en proyecto Supabase real `[!]`

## Fase 4 — Comercio y admin
- [x] Carrito + API scaffolds
- [x] Panel admin stubs
- [x] Quote persistente + checkout create + webhook Stripe (código listo; gated por env)
- [x] Contact/commissions + outbox Resend + cron `/api/cron/outbox` (gated por env)
- [x] Admin magic-link SSR (`/admin/login/`) + gate `admin_users` (sin fake auth)
- [x] Admin CRUD productos/inventario UI + listados pedidos/encargos (gated por auth)
- [x] Admin medios + fichas de obra + galería extra (Supabase; público usa JSON hasta el import)
- [x] Script `pnpm editorial:import` (obra y galería JSON → Supabase)
- [x] Analítica propia anónima + panel `/admin/analytics/` (migración `page_views`)
- [x] Feeds y sincronización del catálogo con Google Merchant y Meta (`/api/admin/catalog-sync`, cron diario)
- [x] Script `pnpm admin:bootstrap` (email → `admin_users`, sin password)
- [ ] Stripe end-to-end en modo test `[!]` (claves + migraciones aplicadas + stock verificado)
- [ ] Formularios reales en staging `[!]` (Resend + service role)
- [ ] Probar panel admin contra Supabase real `[!]`

## Fase 5 — QA y entrega
- [x] `pnpm test` / `pnpm build`
- [x] Redirects + docs mínimos
- [x] Playwright smoke EN/ES + axe critical/serious (`pnpm test:e2e`)
- [x] Scripts entrega: `typecheck` / `lint` / `migration:verify` / `test:e2e`
- [x] e2e carrito (persistencia + remove; add UI bloqueado mientras `saleEnabled: false`)
- [x] `pnpm typecheck` limpio (0 errors)
- [x] Lightbox + comparador foto/dibujo (`src/components/art/*`) en Work detail + Gallery
- [x] Filtros por categoría en índice Work (`?category=`)
- [x] Order status + `lookup_guest_order` / token de acceso (gated por Supabase)
- [x] Admin shop settings (sales/payments flags)
- [x] Copy legal estructural EN/ES (pendiente revisión titular)
- [x] Middleware: no-store en admin/api/checkout + cabeceras de seguridad
- [ ] Ampliar e2e admin/Stripe test cuando haya auth/Stripe
