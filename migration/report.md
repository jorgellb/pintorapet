# Migration report

Date: 2026-10-21  
Spec: `PROMPT_CURSOR_PETSDRAWINGS_ASTRO7.md` §§2–3, Anexo A

## Catalog

| Check | Result |
| --- | --- |
| Products normalized | **18** |
| Unique catalog images | **47** |
| SHA-256 mismatches | **0** |
| Download errors (final) | **0** |
| EUR price match vs live WC Store API | **18/18** (349 / 499 / 999 cents) |

Source snapshot: `migration/source/` (gitignored). Manifests: `migration/products.json`, `migration/assets.json` (versioned). Binaries: `migration/downloads/catalog/` (gitignored).

## Fetch notes

- WooCommerce Store API requires a browser-like `User-Agent`; bare Node `fetch` without UA was blocked (403). Scripts send `PetsDrawingsMigration/1.0`.
- Live prices matched the audit table with **0** mismatches.
- Intra-product duplicate image IDs removed per §2.3.
- “Black” in Labrador titles treated as dog colour, not mug colour. Springer “Black mug” title cleaned to mug without implying black glaze.

## Decisions

- Each product has a **deterministic UUID** (`sha256("petsdrawings:product:v1:{legacyId}")` → UUID shape) so cart/quote schemas work before Supabase import. Re-fetch preserves the same IDs.
- All imported products: `saleEnabled: false`, `inventoryMode: unverified` until the artist confirms stock.
- Editorial EN/ES titles corrected without inventing materials/dimensions.
- Redirect map in `migration/redirects.json` (WP paths → Astro EN/ES, including product and `/my-account/` → guest help).

## Portfolio

- `migration/artworks.json`: **19** Anexo B groups; media under `migration/downloads/portfolio/` and `public/media/portfolio/`.
- One transient download failure (`IMG_1612…`) recovered via curl.

## Publish / import

- `pnpm migration:publish-media` → 47 files in `public/media/catalog/` (+ `migration/media-public.json`).
- `pnpm migration:import-sql` → `supabase/seed/products_from_migration.sql` (sale off, inventory unverified).

## Editorial pages

- `migration/pages.json` via `pnpm migration:pages` (about, contact, commissions, gallery, work — EN+ES).
- Wired into About / Contact / Commissions / Gallery views.

## Extra gallery

- `migration/gallery-extra.json` (10 Anexo C.1 items).
- Mojácar HEIC converted with `scripts/migration/convert-heic.py` → `public/media/gallery/mojacar-0.jpg`.

## Site extras (Anexo C.2–C.5)

- `pnpm migration:extras` → `migration/site-extras.json`
- About (4), commission examples (4), feedbacks (3), logo (1) — all `status: ok`
- Published under `public/media/{about,commissionExamples,feedbacks,brand}/`
- Wired: AboutPage interleaved images, Contact feedbacks grid, Commissions photo/drawing pairs, header logo

## Fonts

- Self-hosted `@fontsource/bodoni-moda` + `@fontsource/manrope` (latin + latin-ext). Google Fonts CDN removed.

## Pending

- Upload of downloads into Supabase Storage buckets

## Commands

```bash
export PATH="$PWD/.tools/node-v24.11.0/bin:$PATH"
pnpm migration:fetch
pnpm migration:assets
pnpm migration:publish-media
pnpm migration:artworks
pnpm migration:extras
pnpm migration:import-sql
pnpm migration:validate
```

Contributors: coordinator + [Migration catalog scripts](29752d03-e719-4051-8c1a-35be2b9c830f).
