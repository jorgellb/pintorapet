-- The home page blocks below the hero, edited in Admin › Portada › Bloques:
-- latest drawings, from photograph to portrait, the shop, the artist and the
-- invitation. One row; an empty table means "as the site shipped".
-- The content is validated by the server (src/lib/content/homeSections.ts).

CREATE TABLE IF NOT EXISTS public.site_home_sections (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.site_home_sections ENABLE ROW LEVEL SECURITY;

-- Public: the home page reads it with the anon key.
DROP POLICY IF EXISTS site_home_sections_read ON public.site_home_sections;
CREATE POLICY site_home_sections_read ON public.site_home_sections
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS site_home_sections_admin_write ON public.site_home_sections;
CREATE POLICY site_home_sections_admin_write ON public.site_home_sections
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.site_home_sections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.site_home_sections TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.site_home_sections TO authenticated;
