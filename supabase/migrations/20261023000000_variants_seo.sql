-- Product variations, artwork SEO and admin create/delete helpers.
--
-- A variation is a full product row (own SKU, price, inventory, photos) that
-- points at its parent. Checkout keeps working per product_id; the parent is
-- itself the first option, labelled with its own variant_label_*.

ALTER TABLE public.products
  ADD COLUMN parent_id uuid REFERENCES public.products (id) ON DELETE RESTRICT,
  ADD COLUMN variant_label_en text NOT NULL DEFAULT '',
  ADD COLUMN variant_label_es text NOT NULL DEFAULT '',
  ADD COLUMN variant_order integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT products_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
  ADD CONSTRAINT products_variant_order_nonneg CHECK (variant_order >= 0);

CREATE INDEX products_parent_id_idx ON public.products (parent_id, variant_order)
  WHERE parent_id IS NOT NULL;

-- Variations hang from a top-level product only.
CREATE OR REPLACE FUNCTION public.products_parent_is_top_level()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.products WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'A variation cannot have its own variations' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.products WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'A product with variations cannot become a variation' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_parent_is_top_level
  BEFORE INSERT OR UPDATE OF parent_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_parent_is_top_level();

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
  p.variant_order
FROM public.products p
JOIN public.categories c ON c.id = p.category_id
JOIN public.inventory inv ON inv.product_id = p.id
WHERE p.status = 'published';

-- ---------------------------------------------------------------------------
-- Artwork SEO
-- ---------------------------------------------------------------------------

ALTER TABLE public.artworks
  ADD COLUMN seo_title_en text NOT NULL DEFAULT '',
  ADD COLUMN seo_title_es text NOT NULL DEFAULT '',
  ADD COLUMN seo_description_en text NOT NULL DEFAULT '',
  ADD COLUMN seo_description_es text NOT NULL DEFAULT '';

CREATE OR REPLACE VIEW public.editorial_artworks_v
WITH (security_invoker = false)
AS
SELECT
  a.id,
  a.legacy_id,
  a.slug_en,
  a.slug_es,
  a.category,
  a.title_en,
  a.title_es,
  a.summary_en,
  a.summary_es,
  a.story_en,
  a.story_es,
  a.sort_order,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'role', aa.role,
          'src', aa.src,
          'label', aa.label,
          'altEn', aa.alt_en,
          'altEs', aa.alt_es,
          'mediaId', aa.media_asset_id
        )
        ORDER BY aa.sort_order, aa.id
      )
      FROM public.artwork_assets aa
      WHERE aa.artwork_id = a.id
    ),
    '[]'::jsonb
  ) AS assets,
  a.seo_title_en,
  a.seo_title_es,
  a.seo_description_en,
  a.seo_description_es
FROM public.artworks a
WHERE a.published;

-- ---------------------------------------------------------------------------
-- Admin: create a product (or a variation) in one transaction
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_product(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_parent public.products%ROWTYPE;
  v_category_id uuid;
  v_motif text;
  v_id uuid;
  v_order integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p ? 'parentId' AND nullif(p->>'parentId', '') IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.products WHERE id = (p->>'parentId')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent product not found' USING ERRCODE = 'foreign_key_violation';
    END IF;
    v_category_id := v_parent.category_id;
    v_motif := v_parent.motif;
    SELECT COALESCE(max(variant_order), 0) + 1 INTO v_order
    FROM public.products WHERE parent_id = v_parent.id;
  ELSE
    SELECT id INTO v_category_id FROM public.categories WHERE code = p->>'categoryCode';
    IF v_category_id IS NULL THEN
      RAISE EXCEPTION 'Unknown category' USING ERRCODE = 'foreign_key_violation';
    END IF;
    v_motif := p->>'motif';
  END IF;

  INSERT INTO public.products (
    sku, category_id, motif, status, price_cents, editorial_order,
    parent_id, variant_label_en, variant_label_es, variant_order
  )
  VALUES (
    p->>'sku',
    v_category_id,
    v_motif,
    COALESCE((p->>'status')::public.product_status, CASE WHEN v_parent.id IS NULL THEN 'draft' ELSE v_parent.status END),
    (p->>'priceCents')::integer,
    COALESCE(
      CASE WHEN v_parent.id IS NULL THEN (SELECT max(editorial_order) + 1 FROM public.products) END,
      v_parent.editorial_order,
      0
    ),
    v_parent.id,
    COALESCE(p->>'variantLabelEn', ''),
    COALESCE(p->>'variantLabelEs', ''),
    v_order
  )
  RETURNING id INTO v_id;

  INSERT INTO public.product_translations (product_id, locale, slug, title, summary, description)
  VALUES
    (v_id, 'en', p->'en'->>'slug', p->'en'->>'title', COALESCE(p->'en'->>'summary', ''), COALESCE(p->'en'->>'description', '')),
    (v_id, 'es', p->'es'->>'slug', p->'es'->>'title', COALESCE(p->'es'->>'summary', ''), COALESCE(p->'es'->>'description', ''));

  INSERT INTO public.inventory (product_id) VALUES (v_id);

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin: delete a product and its variations. Anything already sold or
-- reserved is archived instead, so order history keeps its lines.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_delete_product(p_product_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT array_agg(id) INTO v_ids
  FROM public.products
  WHERE id = p_product_id OR parent_id = p_product_id;

  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE product_id = ANY (v_ids))
     OR EXISTS (SELECT 1 FROM public.stock_reservations WHERE product_id = ANY (v_ids)) THEN
    UPDATE public.products
    SET status = 'archived', sale_enabled = false, archived_at = now()
    WHERE id = ANY (v_ids);
    RETURN 'archived';
  END IF;

  DELETE FROM public.stock_movements WHERE product_id = ANY (v_ids);
  DELETE FROM public.inventory WHERE product_id = ANY (v_ids);
  DELETE FROM public.products WHERE parent_id = p_product_id;
  DELETE FROM public.products WHERE id = p_product_id;
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_product(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_product(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_create_product(jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.admin_delete_product(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.admin_create_product(jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_delete_product(uuid) TO authenticated;
  END IF;
END;
$$;
