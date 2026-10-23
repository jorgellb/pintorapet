-- Editorial content: artwork sheets, extra gallery, tied to media_assets.
-- Public reads go through views. Writes are admin-only via RLS.

CREATE TABLE public.artworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  slug_en text NOT NULL,
  slug_es text NOT NULL,
  category text NOT NULL,
  title_en text NOT NULL,
  title_es text NOT NULL,
  summary_en text NOT NULL DEFAULT '',
  summary_es text NOT NULL DEFAULT '',
  story_en text NOT NULL DEFAULT '',
  story_es text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artworks_legacy_id_unique UNIQUE (legacy_id),
  CONSTRAINT artworks_slug_en_unique UNIQUE (slug_en),
  CONSTRAINT artworks_slug_es_unique UNIQUE (slug_es),
  CONSTRAINT artworks_slug_en_format CHECK (slug_en ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT artworks_slug_es_format CHECK (slug_es ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT artworks_category_known CHECK (
    category IN ('dog', 'cat', 'horse', 'other', 'people')
  ),
  CONSTRAINT artworks_sort_nonneg CHECK (sort_order >= 0)
);

CREATE TRIGGER artworks_set_updated_at
  BEFORE UPDATE ON public.artworks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX artworks_sort_idx ON public.artworks (sort_order);

CREATE TABLE public.artwork_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id uuid NOT NULL REFERENCES public.artworks (id) ON DELETE CASCADE,
  media_asset_id uuid REFERENCES public.media_assets (id) ON DELETE SET NULL,
  role text NOT NULL,
  src text NOT NULL,
  label text,
  alt_en text NOT NULL DEFAULT '',
  alt_es text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT artwork_assets_role_known CHECK (
    role IN (
      'drawing',
      'reference_photo',
      'comparison',
      'process_photo',
      'related_product_photo'
    )
  ),
  CONSTRAINT artwork_assets_sort_nonneg CHECK (sort_order >= 0),
  CONSTRAINT artwork_assets_src_present CHECK (length(trim(src)) > 0)
);

CREATE INDEX artwork_assets_artwork_idx ON public.artwork_assets (artwork_id, sort_order);

CREATE TABLE public.gallery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  item_group text NOT NULL,
  title_en text NOT NULL,
  title_es text NOT NULL,
  summary_en text NOT NULL DEFAULT '',
  summary_es text NOT NULL DEFAULT '',
  story_en text NOT NULL DEFAULT '',
  story_es text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gallery_items_legacy_id_unique UNIQUE (legacy_id),
  CONSTRAINT gallery_items_group_known CHECK (
    item_group IN ('people', 'architecture', 'illustration', 'other')
  ),
  CONSTRAINT gallery_items_sort_nonneg CHECK (sort_order >= 0)
);

CREATE TRIGGER gallery_items_set_updated_at
  BEFORE UPDATE ON public.gallery_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX gallery_items_sort_idx ON public.gallery_items (sort_order);

CREATE TABLE public.gallery_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_item_id uuid NOT NULL REFERENCES public.gallery_items (id) ON DELETE CASCADE,
  media_asset_id uuid REFERENCES public.media_assets (id) ON DELETE SET NULL,
  role text NOT NULL,
  src text NOT NULL,
  alt_en text NOT NULL DEFAULT '',
  alt_es text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT gallery_assets_role_known CHECK (
    role IN ('drawing', 'reference_photo', 'other')
  ),
  CONSTRAINT gallery_assets_sort_nonneg CHECK (sort_order >= 0),
  CONSTRAINT gallery_assets_src_present CHECK (length(trim(src)) > 0)
);

CREATE INDEX gallery_assets_item_idx ON public.gallery_assets (gallery_item_id, sort_order);

-- Published sheets for the public site. Assets travel as JSON so the page
-- can render without joining as the anonymous role.
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
  ) AS assets
FROM public.artworks a
WHERE a.published;

CREATE OR REPLACE VIEW public.editorial_gallery_v
WITH (security_invoker = false)
AS
SELECT
  g.id,
  g.legacy_id,
  g.item_group,
  g.title_en,
  g.title_es,
  g.summary_en,
  g.summary_es,
  g.story_en,
  g.story_es,
  g.sort_order,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'role', ga.role,
          'src', ga.src,
          'altEn', ga.alt_en,
          'altEs', ga.alt_es,
          'mediaId', ga.media_asset_id
        )
        ORDER BY ga.sort_order, ga.id
      )
      FROM public.gallery_assets ga
      WHERE ga.gallery_item_id = g.id
    ),
    '[]'::jsonb
  ) AS assets
FROM public.gallery_items g
WHERE g.published;

COMMENT ON VIEW public.editorial_artworks_v IS
  'Published artwork sheets for the public work pages.';
COMMENT ON VIEW public.editorial_gallery_v IS
  'Published extra-gallery items for the public gallery page.';

ALTER TABLE public.artworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY artworks_admin_all
  ON public.artworks
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY artwork_assets_admin_all
  ON public.artwork_assets
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY gallery_items_admin_all
  ON public.gallery_items
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY gallery_assets_admin_all
  ON public.gallery_assets
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DO $$
DECLARE
  t text;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'artworks',
    'artwork_assets',
    'gallery_items',
    'gallery_assets'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF has_auth THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
        t
      );
    END IF;
  END LOOP;

  IF has_anon THEN
    GRANT SELECT ON public.editorial_artworks_v TO anon;
    GRANT SELECT ON public.editorial_gallery_v TO anon;
  END IF;
  IF has_auth THEN
    GRANT SELECT ON public.editorial_artworks_v TO authenticated;
    GRANT SELECT ON public.editorial_gallery_v TO authenticated;
  END IF;
END;
$$;
