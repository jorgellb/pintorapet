# Plan de implementación — Pets Drawings (Astro 7)

Spec: `PROMPT_CURSOR_PETSDRAWINGS_ASTRO7.md` (auditoría 21 oct 2026).  
Objetivo: web completa EN/ES con tienda Stripe, panel Supabase y migración del catálogo real.

## Decisiones fijadas por el encargo

- Astro 7.x + `@astrojs/vercel` + React islas + `pnpm` + Node 24 (si el entorno solo tiene Node impar, documentar y usar 22 LTS/24).
- `output: 'server'`, i18n con `prefixDefaultLocale: true`, trailing slash.
- Supabase (Postgres/Auth/Storage) + Stripe Checkout + Resend.
- Precios EUR en céntimos; 18 productos; inventario pendiente → venta desactivada hasta verificación.
- Paleta/tipografía del prompt (papel `#f6f3ec`, Bodoni Moda + Manrope).

## Secuencia

1. **Contratos y scaffold** — repo Astro, tokens, i18n/routes, tipos dominio, `.env.example`.
2. **Migración** — scripts, snapshots API/HTML, 47 imágenes, manifiestos JSON, report.
3. **Contenido editorial** — pages/artworks collections EN/ES desde manifiestos.
4. **Diseño público** — layouts, navegación, home→legales, estados vacíos/error.
5. **Datos** — migraciones SQL, RLS, funciones reserva/pago, buckets.
6. **Comercio** — quote, checkout, webhooks, carrito isla, success/cancel.
7. **Admin + formularios** — auth, CRUD, encargos/contacto, outbox.
8. **QA + docs** — Vitest/Playwright, redirects, README y guías operativas.

## Paralelo (cuando haya worktrees/agentes)

Tras contratos: Migración ‖ Diseño ‖ Datos; luego Comercio sobre el esquema; QA al integrar.

## Fuera de este entorno (pendientes externos)

Credenciales Supabase/Stripe/Resend, stock real, textos legales firmados, dominio email, despliegue Vercel live.
