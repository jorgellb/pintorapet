-- The home page hero, edited in Admin › Portada: which of the five designs
-- is shown, its texts in both languages and its images (from Medios).
-- One row; an empty table means "use the built-in defaults".
-- The content is validated by the server (src/lib/content/homeHero.ts).

CREATE TABLE IF NOT EXISTS public.site_home_hero (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.site_home_hero ENABLE ROW LEVEL SECURITY;

-- The hero is public: the home page reads it with the anon key.
DROP POLICY IF EXISTS site_home_hero_read ON public.site_home_hero;
CREATE POLICY site_home_hero_read ON public.site_home_hero
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS site_home_hero_admin_write ON public.site_home_hero;
CREATE POLICY site_home_hero_admin_write ON public.site_home_hero
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.site_home_hero FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.site_home_hero TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.site_home_hero TO authenticated;
