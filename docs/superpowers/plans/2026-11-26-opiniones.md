# Opiniones de clientes con foto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customer reviews with photos.
- Customers write them from a personal per-order link.
- Meili adds her own from Admin and moderates.
- They are shown on the home page, product pages, Encargos and Contacto, and product pages get Review JSON-LD.

**Architecture:**
- Two new tables, `reviews` and `review_photos`, with RLS: admins see everything, the public sees published rows.
- A per-order link whose key is an HMAC computed in TypeScript; nothing is stored.
- Customer photos are kept private in Cloudinary (same pattern as commission photos). On publish they are copied to a public `reviews/` folder; on hide the public copy is destroyed.
- The public pages read published reviews through cached server functions.

**Tech Stack:** Astro 7 SSR, Aiven PostgreSQL (RLS emulation via `asUser`/`asAnon`), Cloudinary REST (`src/lib/server/media/cloudinary.ts`), Resend outbox, zod, vitest, Playwright, Python SQL checks.

**Spec:** `docs/superpowers/specs/2026-11-26-opiniones-design.md`

## Global Constraints

- Public copy in ES and EN; Admin copy in Spanish; code comments in English.
- A review is shown in the language it was written in, with a `lang` attribute; it is never translated.
- Text is at most 1500 characters; at most 3 photos per review; the rating is 1–5 or empty.
- A link is valid 120 days from `orders.paid_at`. Eligible orders have `paid_at` set and `payment_status` `paid` or `partially_refunded`. There is one review per order.
- `verified` is true only for customer reviews from an eligible order. It becomes false when that order is fully refunded. Admin reviews are never verified.
- Meili may edit a customer review's display name, city, pet name and product. The product can only be one of that order's products, or none. She never edits its body or rating. Admin reviews are fully editable.
- A customer can edit a review while it is `pending` and Meili hasn't touched it (`admin_edited_at is null`). Editing does not send a second notice.
- Consent is required to submit and is stored as `consent_at`.
- JSON-LD is added on product pages only, from published, verified reviews of that product that have a rating, at most 10. There is no rating on Organization.
- The home page shows up to 6 published reviews with a photo: featured first, then the newest. Encargos shows `kind='commission'` reviews with a photo. The product page and Contacto show all, with photo or not. Contacto shows 12 per page.
- Never edit applied migrations; the new one is `supabase/migrations/20261126000011_reviews.sql`. Before replacing any existing function, compare its production body with its latest migration.
- Tests send no real emails (`EMAIL_ADMIN=delivered@resend.dev`). Delete the Cloudinary test uploads you create. Use a local Docker DB for e2e. Throwaway specs are named `e2e/zz-*.spec.ts` and deleted afterwards.
- Work on an isolated branch. Commit there at checkpoints, squash into one commit on main at the end, and push (Jorge approved pushing at the end).

## Review Focus

- **Expired, tampered or other-order link:** the page shows a clear «Este enlace no es válido o ha caducado» and reveals nothing about the order. Pinned by Task 2 `link refuses a tampered key / an expired order / a refunded order`.
- **Two uploads at once past the 3-photo cap:** the slot lock refuses the 4th. Pinned by Task 1 `a fourth photo is refused even when two arrive together`.
- **A file that isn't an image:** refused by magic bytes. Pinned by Task 2 `photoType refuses a renamed PDF`; the existing helper is reused.
- **Hiding a published review:** its public photo URLs stop serving. Pinned by Task 2 `hide destroys the public copies, keeps the private ones`.
- **A review of a product later fully refunded:** it drops out of the JSON-LD. Pinned by Task 1 `a full refund clears verified` and Task 5 `JSON-LD ignores unverified reviews`.

---

### Task 1: Schema

**Files:**
- Create: `supabase/migrations/20261126000011_reviews.sql`
- Create: `scripts/sql-check-reviews.py` (harness as in `scripts/sql-check-markets.py`)

**Interfaces — produces (SQL):**
- enum `public.review_status` (`pending`, `published`, `hidden`)
- enum `public.review_kind` (`product`, `commission`, `general`)
- enum `public.review_source` (`customer`, `admin`)
- **table `public.reviews`**
  - `id uuid pk`
  - `source review_source`, `status review_status default 'pending'`, `kind review_kind`
  - `order_id uuid unique references orders on delete set null`
  - `product_id uuid references products on delete set null`
  - `commission_request_id uuid references commission_requests on delete set null`
  - `author_name text not null` (1–80), `city text default ''` (≤80), `pet_name text default ''` (≤60)
  - `body text not null` (1–1500), `locale locale_code`
  - `rating smallint check (1..5)` (nullable)
  - `featured bool default false`, `verified bool default false`
  - `consent_at timestamptz`, `admin_edited_at timestamptz`, `published_at timestamptz`, `created_at`, `updated_at`
  - check: `source='customer'` ⇒ `consent_at is not null and order_id is not null`
  - check: `source='admin'` ⇒ `not verified`
- **table `public.review_photos`**
  - `id uuid pk`, `review_id uuid references reviews on delete cascade`, `position smallint`
  - `private_public_id text` (customer upload), `public_public_id text` (copy made on publish), `media_asset_id uuid references media_assets on delete cascade` (admin pick)
  - `bytes int`, `created_at`
  - check: exactly one of `private_public_id` / `media_asset_id` is set
- **RLS**
  - `reviews` and `review_photos`: select for anon/authenticated when the review is `published`; all access for `is_admin()`.
  - Customer writes go through the service role in TypeScript; there is no customer policy.
- **trigger `reviews_order_refunded`**: AFTER UPDATE OF `payment_status` ON `orders`. When the new status is `refunded`, set `verified = false` on that order's review.
- **trigger `reviews_touch`**: sets `updated_at`.

**Steps**
- [ ] **Step 1: Failing checks**
  - `anon sees only published reviews`
  - `a customer review needs consent and an order`
  - `an admin review is never verified`
  - `rating 6 is refused`
  - `body of 1501 chars is refused`
  - `one review per order`
  - `a full refund clears verified` (use `admin_begin_refund`, or set `payment_status` directly)
  - `a partial refund keeps it`
  - `deleting a review deletes its photo rows`
  - `a photo needs exactly one source`
  - `a fourth photo is refused even when two arrive together`: enforce it in Task 2 with a slot lock. The DB backs it with a trigger `review_photos_max3` that counts under `select … for update` on the review row.
- [ ] **Step 2: Run on a fresh local DB → FAIL.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run it plus the existing SQL checks** (coupons, commission-payments, manual-orders, markets, pickup) **→ all OK.**
- [ ] **Step 5: Commit** "Reviews schema."

### Task 2: Server side

**Files:**
- Create: `src/lib/server/reviews/link.ts`, `src/lib/server/reviews/store.ts`, `src/lib/server/reviews/photos.ts`, `src/lib/domain/reviews.ts`
- Create: `src/pages/api/reviews/index.ts` (POST submit/edit), `src/pages/api/reviews/photos.ts` (POST upload, DELETE one), `src/pages/api/admin/reviews/index.ts` (POST create), `src/pages/api/admin/reviews/[id].ts` (PATCH, DELETE)
- Modify: `src/lib/server/antibot.ts` (add `'review'` to `AntibotForm` and `FORMS`, same thresholds as `'contact'`), `src/lib/server/commerce/outbox.ts` (template `review_admin`; the `order_shipped_customer` text gains the review link when `payload.review_url` is present), `src/lib/server/shipping/admin.ts` (`review_url` in the shipped payload), `src/lib/server/dbTypes.ts` (regenerate)
- Test: `tests/reviews.test.ts`

**Interfaces — produces:**
- **`link.ts`**
  - `reviewKey(orderId: string): string`: base64url HMAC-SHA256 of `'review:' + orderId` with `REVIEW_LINK_SECRET ?? BETTER_AUTH_SECRET`; throws when neither is set.
  - `reviewUrl(order: { id: string; reference: string; locale: 'es' | 'en' }): string`: `${SITE_URL}/es/opinion/?r=REF&k=KEY` or `/en/review/?r=…`.
  - `openReviewLink(db: Db, reference: string, key: string): Promise<ReviewOrder | null>`:
    - compares with `timingSafeEqual`;
    - returns `null` unless the order is eligible: `paid_at` within 120 days, status `paid` or `partially_refunded`;
    - `ReviewOrder = { id; reference; locale; kind: 'product' | 'commission'; products: Array<{ id; title; imageUrl }>; review: CustomerReview | null }`.
- **`domain/reviews.ts`**
  - `reviewInputSchema` (zod, strict):
    `{ reference, key, rating?: 1..5 | null, body: 1..1500 trimmed, authorName: 1..80, city?: ≤80, petName?: ≤60, productId?: uuid | null, locale, consent: literal(true) }`
  - `adminReviewSchema`: create/edit, with `photoIds: uuid[] ≤3` from Medios and `featured`.
  - `defaultAuthorName(fullName: string): string`: "Ana García López" → "Ana G."
  - `type PublicReview = { id; authorName; city; petName; body; locale; rating: number | null; verified: boolean; photos: Array<{ url: string; alt: string }>; publishedAt: string; productId: string | null; kind }`
  - `reviewPhotoAlt(r, locale): string` → «Retrato de {mascota} en casa de {nombre}», with fallbacks when the pet is empty.
- **`store.ts`**
  - `submitCustomerReview(input: ReviewInput, ctx: { ip }): Promise<{ id: string; created: boolean }>`
    - creates the review, or edits it while it is pending and untouched;
    - `productId` must be one of the order's products;
    - sets `kind` and `verified=true`;
    - enqueues `review_admin` on create only, with dedupe `review_admin:<id>`.
  - Admin functions, all run inside `asUser(adminId, …)`:
    - `listReviews(db, status)`, `getReview(db, id)`
    - `createAdminReview(tx, input)`
    - `updateReview(tx, id, patch)`: enforces the editable-field rules from Global Constraints and sets `admin_edited_at`.
    - `publishReview(db, id)`: copies photos, sets `published_at`.
    - `hideReview(db, id)`: destroys the public copies.
    - `deleteReview(db, id)`: destroys private and public copies.
  - Public reads, cached 5 min and reset on any admin write:
    - `homeReviews(): PublicReview[]` (≤6, with a photo, featured first)
    - `productReviews(productId): { reviews: PublicReview[]; average: number | null; count: number }`
    - `commissionReviews(): PublicReview[]`
    - `allReviews(page: number): { reviews; pages }` (12 per page)
- **`photos.ts`**
  - `addReviewPhoto(db, reviewId, file: { bytes; contentType }): Promise<{ id }>`
    - reuses `photoType` and `MAX_PHOTO_BYTES` from `commissionPhotos.ts`;
    - takes a slot under `select … for update` on the review;
    - stores via `uploadPrivateImage` with public id `reviews-private/<reviewId>/<uuid>`.
  - `removeReviewPhoto(db, reviewId, photoId)`
  - `publishPhotos(db, reviewId)`: downloads each private image through `privateDownloadUrl`, re-uploads it with `uploadImage` as `reviews/<reviewId>/<photoId>`, and stores `public_public_id`.
  - `unpublishPhotos(db, reviewId)`: `destroyImage` on the public ids, then nulls them.
  - `purgePhotos(db, reviewId)`: private and public.
- **API**
  - Public routes use the service DB plus `openReviewLink` and `inspect()` from antibot (form `'review'`).
  - `/api/reviews/photos` takes `multipart/form-data` with `r`, `k`, `file`, and refuses when the review is not editable.
  - Admin routes use `requireAdmin`, `dbCall`, `audit` (pattern: `src/pages/api/admin/coupons/*`).
  - Errors are Spanish/English `CommerceError`s, mapped by `pgErrors`.

**Steps**
- [ ] **Step 1: Failing vitest** in `tests/reviews.test.ts`:
  - `reviewKey is stable and differs per order`
  - `link refuses a tampered key / an expired order (121 days) / a refunded order` (fake Db)
  - `defaultAuthorName('Ana García López') === 'Ana G.'` and `('Meili') === 'Meili'`
  - `reviewInputSchema refuses consent false, 1501 chars, rating 0`
  - `photoType refuses a renamed PDF`
  - `submit refuses a product not in the order`
  - `edit is refused once admin_edited_at is set`
  - `hide destroys the public copies, keeps the private ones` (stub Cloudinary `fetchImpl`)
  - `publish copies to reviews/<id>/<photo>`
  - `shipped email text includes the review link when present`
- [ ] **Step 2: Run** `pnpm exec vitest run tests/reviews.test.ts` **→ FAIL.**
- [ ] **Step 3: Implement**, then regenerate dbTypes from a local DB.
- [ ] **Step 4: Run** vitest (all) **and** `pnpm exec astro check` **→ 0 errors.**
- [ ] **Step 5: Commit** "Reviews: links, store, photos, API."

### Task 3: The customer's page and where the link appears

**Files:**
- Modify: `src/i18n/routes.ts` (`review: { en: 'review', es: 'opinion' }`), `src/views/AccountOrderPage.astro` (link «Escribe tu opinión» when eligible), `src/pages/admin/orders/[id].astro` («Copiar enlace de opinión» button when eligible)
- Create: `src/pages/es/opinion/index.astro`, `src/pages/en/review/index.astro`, `src/views/ReviewPage.astro`, `src/scripts/reviewForm.ts`

**Interfaces — consumes:** Task 2 (`openReviewLink`, `reviewUrl`, the API routes).

**Steps**
- [ ] **Step 1: Build the page.** It is SSR with `noindex`.
  - **Invalid link:** «Este enlace no es válido o ha caducado. Si crees que es un error, escribe a Meili.» (EN equivalent).
  - **Valid link:** the ordered pieces as thumbnails, then a product choice when there are several («¿De qué pieza nos hablas?», plus «Del pedido en general»).
  - **Stars:** five radio buttons, labelled 1–5, keyboard friendly, can be cleared.
  - **Form fields:**
    - textarea with a live counter out of 1500;
    - up to 3 photos, resized in the browser like the commission form (reuse its resize code; find it with `grep -rn "2400" src/scripts`);
    - name, prefilled with `defaultAuthorName`;
    - city and pet name;
    - consent checkbox with the exact spec text;
    - an `AntiBot` component.
  - **After sending:** «Gracias. Meili la leerá antes de publicarla.» A returning visitor sees their review: editable when allowed, read-only otherwise.
  - **Style:** the site's paper forms (`src/styles/paper-forms.css`). It must work at 390 px.
- [ ] **Step 2: Wire the links** in My account and Admin orders.
- [ ] **Step 3: Check with throwaway `e2e/zz-review-customer.spec.ts`** on the local server (port 4322, local DB, Cloudinary real but under a `reviews-private/test-*` id):
  - invalid key → message;
  - submit with 1 photo → pending in DB;
  - edit → updated;
  - after `admin_edited_at` → read-only;
  - screenshots at 1280 and 390;
  - then delete the test uploads and the spec.
- [ ] **Step 4: Commit** "Reviews: the customer's page and links."

### Task 4: Admin › Opiniones

**Files:**
- Create: `src/pages/admin/reviews/index.astro`, `src/pages/admin/reviews/[id].astro` (`new` for a new one)
- Modify: `src/layouts/AdminLayout.astro` (nav `{ href: '/admin/reviews/', label: 'Opiniones' }` after Encargos, with the pending count badge if the nav supports one)

**Interfaces — consumes:** Task 2 admin API and store.

**Steps**
- [ ] **Step 1: List page.** Tabs Pendientes (n) / Publicadas / Ocultas. Each row shows stars, an excerpt, author, «Compra verificada» chip, source chip («Cliente»/«Meili»), product and a thumbnail.
- [ ] **Step 2: Detail page.**
  - Body read-only for customer reviews.
  - Editable fields per Global Constraints; product select limited to the order's products.
  - Photos: private ones through a signed `privateDownloadUrl` (10 min); public ones through their URL.
  - Actions: Publicar, Ocultar, Destacar en portada (toggle), Borrar (confirm).
  - New or admin reviews: photos from Medios via `pickMedia({ multiple: true })` (pattern: `src/pages/admin/markets/index.astro`).
- [ ] **Step 3: Check with throwaway `e2e/zz-reviews-admin.spec.ts`:**
  - publish a seeded customer review → public URL serves;
  - hide → it 404s;
  - create an admin review with a Medios photo;
  - screenshots at 1280 and 390;
  - delete the spec and the test uploads.
- [ ] **Step 4: Commit** "Admin › Opiniones."

### Task 5: Reviews on the public pages

**Files:**
- Create: `src/components/reviews/ReviewCard.astro`, `src/components/reviews/ReviewList.astro`, `src/components/reviews/Stars.astro`, `src/components/PhotoViewer.astro` (extracted from `src/views/MarketsPage.astro`'s dialog and script)
- Modify: `src/views/MarketsPage.astro` (use `PhotoViewer`), `src/views/HomePage.astro` (section «Lo que dicen» / "Kind words", after the boutique section), `src/views/ProductPage.astro` («Opiniones», with average), `src/lib/catalog/productJsonLd.ts` (optional `reviews` input), `src/views/CommissionsPage.astro`, `src/views/ContactPage.astro` (replace the screenshot grid with `ReviewList` paginated by `?p=`), `src/i18n/es.ts` + `src/i18n/en.ts`

**Interfaces — consumes:** Task 2 public reads and `PublicReview`.

**Produces:**
- `productJsonLd(input & { reviews?: { average: number; count: number; items: PublicReview[] } })`. When `count > 0` it adds:
  - `aggregateRating { ratingValue: average rounded to 1 decimal, reviewCount: count, bestRating: 5 }`
  - `review: items.map(r => ({ '@type': 'Review', author: { '@type': 'Person', name: r.authorName }, reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 }, reviewBody: r.body, datePublished }))`

**Steps**
- [ ] **Step 1: Failing vitest in `tests/reviewsJsonLd.test.ts`:**
  - `JSON-LD ignores unverified reviews and reviews without rating`: the caller passes only verified rated ones; assert that `productReviews`' JSON-LD subset filter does this.
  - `aggregateRating 4.67 → 4.7`
  - `no reviews → no aggregateRating key`
- [ ] **Step 2: Implement the components and pages.**
  - Stars as SVG with an `aria-label` «4 de 5».
  - An excerpt of about 220 characters on home cards, with «Leer más» opening the full text in the viewer.
  - Photos open in `PhotoViewer`.
  - Empty states hide the section.
  - Design follows each page's existing style. The signature is the photo of the portrait at home: large, slightly framed like a print on the wall, so the card reads as a moment, not a widget.
  - Respect reduced motion.
- [ ] **Step 3: Check with throwaway `e2e/zz-reviews-public.spec.ts`** (seeded published reviews with and without photos):
  - home shows only reviews with a photo, featured first, ≤6;
  - product page shows its reviews, the average, and the JSON-LD script;
  - Encargos shows commission reviews;
  - Contacto paginates;
  - the Markets page viewer still works;
  - screenshots at 1280 and 390;
  - also run the existing `e2e/product-page.spec.ts` and `e2e/smoke.spec.ts`.
- [ ] **Step 4: Run vitest and astro check, then commit** "Reviews on the home, product, commissions and contact pages."

### Task 6: Production

- [ ] **Step 1:** Run all vitest, astro check, and every SQL check locally (reviews plus the five existing ones) → pass.
- [ ] **Step 2:** Compare the production bodies of any existing function the migration replaces (none are expected; the triggers are new). Then run `apply-schema.py aiven --dry-run`, apply, `gen-types.py aiven`, and the SQL checks on `aiven` (use `AIVEN_CA_CERT_PATH=/home/jorge/Documentos/PintoraPet/certs/aiven-ca.pem`).
- [ ] **Step 3:** Make sure `REVIEW_LINK_SECRET` is not required: the fallback is `BETTER_AUTH_SECRET`, which is already in Vercel. Note it for Jorge.
- [ ] **Step 4:** Squash into one commit on main, push, update the main checkout, and report in Spanish.
