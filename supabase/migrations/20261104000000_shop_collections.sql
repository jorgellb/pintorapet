-- Shop categories: the portraits the shop is arranged by (Jack Russell,
-- Pug…), edited in Admin › Tienda › Categorías. Each product belongs to at
-- most one. Not to be confused with public.categories, the product type
-- (card, coaster, mug) that sets the VAT rate and the shipping weight.

CREATE TABLE IF NOT EXISTS public.shop_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  portrait_media_id uuid REFERENCES public.media_assets (id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_collections_code_unique UNIQUE (code),
  CONSTRAINT shop_collections_code_format CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(code) <= 60),
  CONSTRAINT shop_collections_names CHECK (
    length(btrim(name_es)) BETWEEN 1 AND 80 AND length(btrim(name_en)) BETWEEN 1 AND 80
  ),
  CONSTRAINT shop_collections_descriptions CHECK (
    length(description_es) <= 400 AND length(description_en) <= 400
  )
);

DROP TRIGGER IF EXISTS shop_collections_set_updated_at ON public.shop_collections;
CREATE TRIGGER shop_collections_set_updated_at
  BEFORE UPDATE ON public.shop_collections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES public.shop_collections (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS products_collection_id_idx ON public.products (collection_id);

ALTER TABLE public.shop_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_collections_admin_all ON public.shop_collections;
CREATE POLICY shop_collections_admin_all ON public.shop_collections
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.shop_collections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_collections TO authenticated;

-- What the shop reads: visible categories, with the portrait's file.
CREATE OR REPLACE VIEW public.catalog_collections_v
WITH (security_invoker = false)
AS
SELECT
  sc.id,
  sc.code,
  sc.name_es,
  sc.name_en,
  sc.description_es,
  sc.description_en,
  sc.sort_order,
  ma.bucket AS portrait_bucket,
  ma.object_path AS portrait_path
FROM public.shop_collections sc
LEFT JOIN public.media_assets ma ON ma.id = sc.portrait_media_id
WHERE sc.published;

REVOKE ALL ON public.catalog_collections_v FROM PUBLIC;
GRANT SELECT ON public.catalog_collections_v TO anon, authenticated;

-- The public product view gains the product's category (last column, so
-- existing readers are unaffected).
CREATE OR REPLACE VIEW public.catalog_products_v
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.sku,
  c.code AS category_code,
  p.motif,
  p.status,
  p.price_cents,
  p.currency,
  p.editorial_order,
  p.sale_enabled,
  inv.inventory_mode,
  CASE
    WHEN p.status <> 'published' THEN 'unavailable'
    WHEN NOT p.sale_enabled OR inv.inventory_mode = 'unverified' THEN 'unverified'
    WHEN inv.inventory_mode = 'made_to_order' THEN 'available'
    WHEN inv.stock_on_hand - inv.stock_reserved > 0 THEN 'available'
    ELSE 'sold_out'
  END AS availability,
  p.updated_at,
  p.parent_id,
  p.variant_label_en,
  p.variant_label_es,
  p.variant_order,
  p.collection_id
FROM public.products p
JOIN public.categories c ON c.id = p.category_id
JOIN public.inventory inv ON inv.product_id = p.id
WHERE p.status = 'published';

-- The portraits the shop already had, plus the three new ones, in the
-- order the shop showed them.
INSERT INTO public.shop_collections (code, name_es, name_en, sort_order)
VALUES
  ('jack-russell-terrier', 'Jack Russell', 'Jack Russell', 10),
  ('border-collie', 'Border Collie', 'Border Collie', 20),
  ('dachshund', 'Teckel', 'Dachshund', 30),
  ('golden-retriever', 'Golden Retriever', 'Golden Retriever', 40),
  ('labrador-retriever-black', 'Labrador negro', 'Black Labrador', 50),
  ('springer-spaniel', 'Springer Spaniel', 'Springer Spaniel', 60),
  ('cockapoo', 'Cockapoo', 'Cockapoo', 70),
  ('french-bulldog', 'Bulldog francés', 'French Bulldog', 80),
  ('pug', 'Pug', 'Pug', 90)
ON CONFLICT (code) DO NOTHING;

-- Each product joins the category named like its motif ("Golden Retriever"
-- → golden-retriever), variations included.
UPDATE public.products p
SET collection_id = sc.id
FROM public.shop_collections sc
WHERE p.collection_id IS NULL
  AND sc.code = trim(BOTH '-' FROM lower(regexp_replace(p.motif, '[^a-zA-Z0-9]+', '-', 'g')));
