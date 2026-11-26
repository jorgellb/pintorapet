-- Photos of a market (Admin › Mercados), shown on the "Dónde estaré" page:
-- images from Medios, in order. Deleting an image from Medios takes it off the market.

CREATE TABLE IF NOT EXISTS public.market_photos (
  market_id uuid NOT NULL REFERENCES public.markets (id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES public.media_assets (id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (market_id, media_asset_id),
  CONSTRAINT market_photos_position_nonneg CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS market_photos_media_idx ON public.market_photos (media_asset_id);

ALTER TABLE public.market_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_photos_public_read ON public.market_photos;
CREATE POLICY market_photos_public_read ON public.market_photos
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.markets m WHERE m.id = market_id AND (m.published OR public.is_admin())));
DROP POLICY IF EXISTS market_photos_admin_write ON public.market_photos;
CREATE POLICY market_photos_admin_write ON public.market_photos
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.market_photos FROM PUBLIC, anon;
GRANT SELECT ON public.market_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_photos TO authenticated;
