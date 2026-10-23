-- Generated from migration/products.json — review before applying
-- Requires categories seeded (greeting-cards, coasters, mugs)
-- Inventory remains unverified; sale_enabled = false
BEGIN;

-- Springer Spaniel Greeting Card (legacy 2042)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  'a2cd5272-699c-4820-81fc-53e179657646'::uuid,
  2042,
  'PD-2042',
  (SELECT id FROM public.categories WHERE code = 'greeting-cards'),
  'Springer Spaniel',
  'published',
  349,
  'EUR',
  false,
  2042
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('a2cd5272-699c-4820-81fc-53e179657646'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'a2cd5272-699c-4820-81fc-53e179657646'::uuid,
  'en',
  'springer-spaniel-greeting-card',
  'Springer Spaniel Greeting Card',
  'Springer Spaniel Greeting Card from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'a2cd5272-699c-4820-81fc-53e179657646'::uuid,
  'es',
  'tarjeta-springer-spaniel',
  'Tarjeta de felicitación Springer Spaniel',
  'Tarjeta de felicitación Springer Spaniel de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Springer Spaniel Coaster (legacy 1977)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '0d63902d-f6e7-47ec-84b7-c6dfc8cfb09f'::uuid,
  1977,
  'PD-1977',
  (SELECT id FROM public.categories WHERE code = 'coasters'),
  'Springer Spaniel',
  'published',
  499,
  'EUR',
  false,
  1977
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('0d63902d-f6e7-47ec-84b7-c6dfc8cfb09f'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '0d63902d-f6e7-47ec-84b7-c6dfc8cfb09f'::uuid,
  'en',
  'springer-spaniel-coaster',
  'Springer Spaniel Coaster',
  'Springer Spaniel Coaster from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '0d63902d-f6e7-47ec-84b7-c6dfc8cfb09f'::uuid,
  'es',
  'posavasos-springer-spaniel',
  'Posavasos Springer Spaniel',
  'Posavasos Springer Spaniel de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Springer Spaniel Mug (legacy 1974)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  'fb0f1033-20c1-46aa-a64e-d38ca7e971d4'::uuid,
  1974,
  'PD-1974',
  (SELECT id FROM public.categories WHERE code = 'mugs'),
  'Springer Spaniel',
  'published',
  999,
  'EUR',
  false,
  1974
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('fb0f1033-20c1-46aa-a64e-d38ca7e971d4'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'fb0f1033-20c1-46aa-a64e-d38ca7e971d4'::uuid,
  'en',
  'springer-spaniel-mug',
  'Springer Spaniel Mug',
  'Springer Spaniel Mug from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'fb0f1033-20c1-46aa-a64e-d38ca7e971d4'::uuid,
  'es',
  'taza-springer-spaniel',
  'Taza Springer Spaniel',
  'Taza Springer Spaniel de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Black Labrador Retriever Greeting Card (legacy 1968)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '2af71471-2f4f-4dfc-9bc0-525364c76c49'::uuid,
  1968,
  'PD-1968',
  (SELECT id FROM public.categories WHERE code = 'greeting-cards'),
  'Labrador Retriever Black',
  'published',
  349,
  'EUR',
  false,
  1968
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('2af71471-2f4f-4dfc-9bc0-525364c76c49'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '2af71471-2f4f-4dfc-9bc0-525364c76c49'::uuid,
  'en',
  'black-labrador-greeting-card',
  'Black Labrador Retriever Greeting Card',
  'Black Labrador Retriever Greeting Card from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '2af71471-2f4f-4dfc-9bc0-525364c76c49'::uuid,
  'es',
  'tarjeta-labrador-negro',
  'Tarjeta de felicitación Labrador Retriever negro',
  'Tarjeta de felicitación Labrador Retriever negro de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Black Labrador Retriever Coaster (legacy 1964)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '4de79af5-4128-4989-97f3-3d5665b53cf8'::uuid,
  1964,
  'PD-1964',
  (SELECT id FROM public.categories WHERE code = 'coasters'),
  'Labrador Retriever Black',
  'published',
  499,
  'EUR',
  false,
  1964
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('4de79af5-4128-4989-97f3-3d5665b53cf8'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '4de79af5-4128-4989-97f3-3d5665b53cf8'::uuid,
  'en',
  'black-labrador-coaster',
  'Black Labrador Retriever Coaster',
  'Black Labrador Retriever Coaster from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '4de79af5-4128-4989-97f3-3d5665b53cf8'::uuid,
  'es',
  'posavasos-labrador-negro',
  'Posavasos Labrador Retriever negro',
  'Posavasos Labrador Retriever negro de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Black Labrador Retriever Mug (legacy 1961)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '4e640929-6309-476b-9bbd-9a6ba55ca2fc'::uuid,
  1961,
  'PD-1961',
  (SELECT id FROM public.categories WHERE code = 'mugs'),
  'Labrador Retriever Black',
  'published',
  999,
  'EUR',
  false,
  1961
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('4e640929-6309-476b-9bbd-9a6ba55ca2fc'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '4e640929-6309-476b-9bbd-9a6ba55ca2fc'::uuid,
  'en',
  'black-labrador-mug',
  'Black Labrador Retriever Mug',
  'Black Labrador Retriever Mug from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '4e640929-6309-476b-9bbd-9a6ba55ca2fc'::uuid,
  'es',
  'taza-labrador-negro',
  'Taza Labrador Retriever negro',
  'Taza Labrador Retriever negro de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Golden Retriever Greeting Card (legacy 1957)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  'e35296dd-d678-41ba-9a09-99a9ef04d65a'::uuid,
  1957,
  'PD-1957',
  (SELECT id FROM public.categories WHERE code = 'greeting-cards'),
  'Golden Retriever',
  'published',
  349,
  'EUR',
  false,
  1957
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('e35296dd-d678-41ba-9a09-99a9ef04d65a'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'e35296dd-d678-41ba-9a09-99a9ef04d65a'::uuid,
  'en',
  'golden-retriever-greeting-card',
  'Golden Retriever Greeting Card',
  'Golden Retriever Greeting Card from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'e35296dd-d678-41ba-9a09-99a9ef04d65a'::uuid,
  'es',
  'tarjeta-golden-retriever',
  'Tarjeta de felicitación Golden Retriever',
  'Tarjeta de felicitación Golden Retriever de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Golden Retriever Coaster (legacy 1953)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '12ec4f9f-5d8d-4962-9081-1d222b2af182'::uuid,
  1953,
  'PD-1953',
  (SELECT id FROM public.categories WHERE code = 'coasters'),
  'Golden Retriever',
  'published',
  499,
  'EUR',
  false,
  1953
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('12ec4f9f-5d8d-4962-9081-1d222b2af182'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '12ec4f9f-5d8d-4962-9081-1d222b2af182'::uuid,
  'en',
  'golden-retriever-coaster',
  'Golden Retriever Coaster',
  'Golden Retriever Coaster from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '12ec4f9f-5d8d-4962-9081-1d222b2af182'::uuid,
  'es',
  'posavasos-golden-retriever',
  'Posavasos Golden Retriever',
  'Posavasos Golden Retriever de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Golden Retriever Mug (legacy 1950)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '5c185ca6-59e9-4fe3-8853-e72256032e50'::uuid,
  1950,
  'PD-1950',
  (SELECT id FROM public.categories WHERE code = 'mugs'),
  'Golden Retriever',
  'published',
  999,
  'EUR',
  false,
  1950
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('5c185ca6-59e9-4fe3-8853-e72256032e50'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '5c185ca6-59e9-4fe3-8853-e72256032e50'::uuid,
  'en',
  'golden-retriever-mug',
  'Golden Retriever Mug',
  'Golden Retriever Mug from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '5c185ca6-59e9-4fe3-8853-e72256032e50'::uuid,
  'es',
  'taza-golden-retriever',
  'Taza Golden Retriever',
  'Taza Golden Retriever de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Dachshund Greeting Card (legacy 1944)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  'a63a34d6-f8fe-44c9-b872-33c98e0c499f'::uuid,
  1944,
  'PD-1944',
  (SELECT id FROM public.categories WHERE code = 'greeting-cards'),
  'Dachshund',
  'published',
  349,
  'EUR',
  false,
  1944
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('a63a34d6-f8fe-44c9-b872-33c98e0c499f'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'a63a34d6-f8fe-44c9-b872-33c98e0c499f'::uuid,
  'en',
  'dachshund-greeting-card',
  'Dachshund Greeting Card',
  'Dachshund Greeting Card from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'a63a34d6-f8fe-44c9-b872-33c98e0c499f'::uuid,
  'es',
  'tarjeta-teckel',
  'Tarjeta de felicitación Teckel',
  'Tarjeta de felicitación Teckel de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Dachshund Coaster (legacy 1940)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '9c4b2603-d071-4699-80fb-07695e88afc4'::uuid,
  1940,
  'PD-1940',
  (SELECT id FROM public.categories WHERE code = 'coasters'),
  'Dachshund',
  'published',
  499,
  'EUR',
  false,
  1940
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('9c4b2603-d071-4699-80fb-07695e88afc4'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '9c4b2603-d071-4699-80fb-07695e88afc4'::uuid,
  'en',
  'dachshund-coaster',
  'Dachshund Coaster',
  'Dachshund Coaster from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '9c4b2603-d071-4699-80fb-07695e88afc4'::uuid,
  'es',
  'posavasos-teckel',
  'Posavasos Teckel',
  'Posavasos Teckel de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Dachshund Mug (legacy 1937)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '89d7608d-ef54-4afa-a8dd-a90290dde67f'::uuid,
  1937,
  'PD-1937',
  (SELECT id FROM public.categories WHERE code = 'mugs'),
  'Dachshund',
  'published',
  999,
  'EUR',
  false,
  1937
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('89d7608d-ef54-4afa-a8dd-a90290dde67f'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '89d7608d-ef54-4afa-a8dd-a90290dde67f'::uuid,
  'en',
  'dachshund-mug',
  'Dachshund Mug',
  'Dachshund Mug from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '89d7608d-ef54-4afa-a8dd-a90290dde67f'::uuid,
  'es',
  'taza-teckel',
  'Taza Teckel',
  'Taza Teckel de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Border Collie Greeting Card (legacy 1826)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '78549280-7be7-4dab-b6fa-95de170b93ab'::uuid,
  1826,
  'PD-1826',
  (SELECT id FROM public.categories WHERE code = 'greeting-cards'),
  'Border Collie',
  'published',
  349,
  'EUR',
  false,
  1826
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('78549280-7be7-4dab-b6fa-95de170b93ab'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '78549280-7be7-4dab-b6fa-95de170b93ab'::uuid,
  'en',
  'border-collie-greeting-card',
  'Border Collie Greeting Card',
  'Border Collie Greeting Card from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '78549280-7be7-4dab-b6fa-95de170b93ab'::uuid,
  'es',
  'tarjeta-border-collie',
  'Tarjeta de felicitación Border Collie',
  'Tarjeta de felicitación Border Collie de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Border Collie Coaster (legacy 1822)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  'bedbe57d-fdf1-4af9-9331-f9e680bc1a14'::uuid,
  1822,
  'PD-1822',
  (SELECT id FROM public.categories WHERE code = 'coasters'),
  'Border Collie',
  'published',
  499,
  'EUR',
  false,
  1822
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('bedbe57d-fdf1-4af9-9331-f9e680bc1a14'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'bedbe57d-fdf1-4af9-9331-f9e680bc1a14'::uuid,
  'en',
  'border-collie-coaster',
  'Border Collie Coaster',
  'Border Collie Coaster from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  'bedbe57d-fdf1-4af9-9331-f9e680bc1a14'::uuid,
  'es',
  'posavasos-border-collie',
  'Posavasos Border Collie',
  'Posavasos Border Collie de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Border Collie Mug (legacy 1817)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '61337513-d42e-40af-9334-3a8c5ee4c7e1'::uuid,
  1817,
  'PD-1817',
  (SELECT id FROM public.categories WHERE code = 'mugs'),
  'Border Collie',
  'published',
  999,
  'EUR',
  false,
  1817
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('61337513-d42e-40af-9334-3a8c5ee4c7e1'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '61337513-d42e-40af-9334-3a8c5ee4c7e1'::uuid,
  'en',
  'border-collie-mug',
  'Border Collie Mug',
  'Border Collie Mug from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '61337513-d42e-40af-9334-3a8c5ee4c7e1'::uuid,
  'es',
  'taza-border-collie',
  'Taza Border Collie',
  'Taza Border Collie de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Jack Russell Terrier Coaster (legacy 1798)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '79c64cde-65b1-43a7-a525-f30bd4ba9a49'::uuid,
  1798,
  'PD-1798',
  (SELECT id FROM public.categories WHERE code = 'coasters'),
  'Jack Russell Terrier',
  'published',
  499,
  'EUR',
  false,
  1798
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('79c64cde-65b1-43a7-a525-f30bd4ba9a49'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '79c64cde-65b1-43a7-a525-f30bd4ba9a49'::uuid,
  'en',
  'jack-russell-coaster',
  'Jack Russell Terrier Coaster',
  'Jack Russell Terrier Coaster from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '79c64cde-65b1-43a7-a525-f30bd4ba9a49'::uuid,
  'es',
  'posavasos-jack-russell',
  'Posavasos Jack Russell Terrier',
  'Posavasos Jack Russell Terrier de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Jack Russell Terrier Greeting Card (legacy 1803)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '27437ade-8baf-4312-ba7d-b55352085237'::uuid,
  1803,
  'PD-1803',
  (SELECT id FROM public.categories WHERE code = 'greeting-cards'),
  'Jack Russell Terrier',
  'published',
  349,
  'EUR',
  false,
  1803
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('27437ade-8baf-4312-ba7d-b55352085237'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '27437ade-8baf-4312-ba7d-b55352085237'::uuid,
  'en',
  'jack-russell-greeting-card',
  'Jack Russell Terrier Greeting Card',
  'Jack Russell Terrier Greeting Card from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '27437ade-8baf-4312-ba7d-b55352085237'::uuid,
  'es',
  'tarjeta-jack-russell',
  'Tarjeta de felicitación Jack Russell Terrier',
  'Tarjeta de felicitación Jack Russell Terrier de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

-- Jack Russell Terrier Mug (legacy 1789)
INSERT INTO public.products (
  id, legacy_id, sku, category_id, motif, status, price_cents, currency,
  sale_enabled, editorial_order
) VALUES (
  '6bb7102d-0b8f-4e54-9488-508ccdca239f'::uuid,
  1789,
  'PD-1789',
  (SELECT id FROM public.categories WHERE code = 'mugs'),
  'Jack Russell Terrier',
  'published',
  999,
  'EUR',
  false,
  1789
) ON CONFLICT (legacy_id) DO UPDATE SET
  sku = EXCLUDED.sku,
  category_id = EXCLUDED.category_id,
  price_cents = EXCLUDED.price_cents,
  motif = EXCLUDED.motif,
  editorial_order = EXCLUDED.editorial_order,
  updated_at = now();
INSERT INTO public.inventory (product_id, stock_on_hand, stock_reserved, inventory_mode)
VALUES ('6bb7102d-0b8f-4e54-9488-508ccdca239f'::uuid, 0, 0, 'unverified')
ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '6bb7102d-0b8f-4e54-9488-508ccdca239f'::uuid,
  'en',
  'jack-russell-mug',
  'Jack Russell Terrier Mug',
  'Jack Russell Terrier Mug from Pets Drawings.',
  'Illustrated product from Meili’s pet portrait drawings.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();
INSERT INTO public.product_translations (
  product_id, locale, slug, title, summary, description
) VALUES (
  '6bb7102d-0b8f-4e54-9488-508ccdca239f'::uuid,
  'es',
  'taza-jack-russell',
  'Taza Jack Russell Terrier',
  'Taza Jack Russell Terrier de Pets Drawings.',
  'Producto ilustrado a partir de los retratos de mascotas de Meili.'
) ON CONFLICT (product_id, locale) DO UPDATE SET
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  updated_at = now();

COMMIT;
