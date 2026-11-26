-- Reviews (Admin › Opiniones): what customers say about an order, moderated by
-- Meili before it shows on the web. Customers write through the server with the
-- service role (a signed link per order, no account), so there is no customer
-- policy here: anon and signed-in customers only read what is published; the
-- admin reads and writes everything.

CREATE TYPE public.review_status AS ENUM ('pending', 'published', 'hidden');
CREATE TYPE public.review_kind AS ENUM ('product', 'commission', 'general');
CREATE TYPE public.review_source AS ENUM ('customer', 'admin');

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source public.review_source NOT NULL,
  status public.review_status NOT NULL DEFAULT 'pending',
  kind public.review_kind NOT NULL,
  -- One review per order. The review outlives the order, the product and the commission.
  -- (ON DELETE SET NULL cannot hit a customer review: it needs an order_id, and only unpaid orders are deletable.)
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  commission_request_id uuid REFERENCES public.commission_requests (id) ON DELETE SET NULL,
  -- As the author wants to appear ("Ana G.").
  author_name text NOT NULL,
  city text NOT NULL DEFAULT '',
  pet_name text NOT NULL DEFAULT '',
  body text NOT NULL,
  -- The language it was written in.
  locale public.locale_code NOT NULL,
  rating smallint,
  -- Shown on the home page.
  featured boolean NOT NULL DEFAULT false,
  -- "Compra verificada": comes from a paid order; a full refund clears it.
  verified boolean NOT NULL DEFAULT false,
  -- When the customer accepted that their words, name and photos are published.
  consent_at timestamptz,
  -- When Meili last touched a customer's review (the customer can no longer edit it).
  admin_edited_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_order_unique UNIQUE (order_id),
  CONSTRAINT reviews_author_name_length CHECK (char_length(author_name) BETWEEN 1 AND 80),
  CONSTRAINT reviews_city_length CHECK (char_length(city) <= 80),
  CONSTRAINT reviews_pet_name_length CHECK (char_length(pet_name) <= 60),
  CONSTRAINT reviews_body_length CHECK (char_length(body) BETWEEN 1 AND 1500),
  CONSTRAINT reviews_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_customer_needs_consent_and_order CHECK (
    source <> 'customer' OR (consent_at IS NOT NULL AND order_id IS NOT NULL)
  ),
  CONSTRAINT reviews_admin_not_verified CHECK (source <> 'admin' OR NOT verified)
);

CREATE INDEX IF NOT EXISTS reviews_status_created_idx ON public.reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_product_published_idx ON public.reviews (product_id, published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS reviews_commission_idx ON public.reviews (commission_request_id) WHERE commission_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reviews_featured_idx ON public.reviews (published_at DESC) WHERE status = 'published' AND featured;

DROP TRIGGER IF EXISTS reviews_touch ON public.reviews;
CREATE TRIGGER reviews_touch
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_public_read ON public.reviews;
CREATE POLICY reviews_public_read ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (status = 'published');
DROP POLICY IF EXISTS reviews_admin_all ON public.reviews;
CREATE POLICY reviews_admin_all ON public.reviews
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.reviews FROM PUBLIC, anon;
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;

-- Up to three photos per review. A customer's photo is private until the review
-- is published: then a public copy is made (public_public_id). An admin review
-- picks images from Medios (media_asset_id); deleting the image in Medios takes
-- it off the review.
CREATE TABLE IF NOT EXISTS public.review_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews (id) ON DELETE CASCADE,
  position smallint NOT NULL DEFAULT 0,
  private_public_id text,
  public_public_id text,
  media_asset_id uuid REFERENCES public.media_assets (id) ON DELETE CASCADE,
  bytes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_photos_position_unique UNIQUE (review_id, position),
  CONSTRAINT review_photos_one_source CHECK ((private_public_id IS NOT NULL) <> (media_asset_id IS NOT NULL)),
  CONSTRAINT review_photos_position_nonneg CHECK (position >= 0),
  CONSTRAINT review_photos_bytes_nonneg CHECK (bytes IS NULL OR bytes >= 0)
);

CREATE INDEX IF NOT EXISTS review_photos_media_idx ON public.review_photos (media_asset_id) WHERE media_asset_id IS NOT NULL;

ALTER TABLE public.review_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_photos_public_read ON public.review_photos;
CREATE POLICY review_photos_public_read ON public.review_photos
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = review_id AND r.status = 'published'));
DROP POLICY IF EXISTS review_photos_admin_all ON public.review_photos;
CREATE POLICY review_photos_admin_all ON public.review_photos
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Nobody reads the private copy's id or the size through the API roles, not even a
-- signed-in customer looking at a published review: the server reads them as the owner.
REVOKE ALL ON public.review_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, review_id, position, public_public_id, media_asset_id, created_at)
  ON public.review_photos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.review_photos TO authenticated;

-- Three photos at most, even when two uploads arrive together: each insert
-- takes the review row's lock first, so the second waits and then counts the
-- first one's photo. (SECURITY DEFINER: the lock and the count must not depend
-- on what the caller may see.)
CREATE OR REPLACE FUNCTION public.review_photos_max3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.review_id = OLD.review_id THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.reviews WHERE id = NEW.review_id FOR UPDATE;
  IF (SELECT count(*) FROM public.review_photos WHERE review_id = NEW.review_id) >= 3 THEN
    RAISE EXCEPTION 'REVIEW_PHOTOS_MAX' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.review_photos_max3() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS review_photos_max3 ON public.review_photos;
CREATE TRIGGER review_photos_max3
  BEFORE INSERT OR UPDATE OF review_id ON public.review_photos
  FOR EACH ROW EXECUTE FUNCTION public.review_photos_max3();

-- Adding, removing or moving a photo changes the review: it bumps the review's
-- updated_at (old and new review on a move), which is what Meili's "publish"
-- compares against, so a photo that arrives after she read the review makes the
-- publish refuse. It is not fired for public_public_id (publishing copies the
-- photos and must not move updated_at itself) nor for bytes. AFTER, and it only
-- writes to reviews, so it neither loops with review_photos_max3 (a BEFORE
-- trigger that only reads and locks) nor with reviews_touch (which does not
-- touch photos). Deleting a review cascades its photos here, finds no review
-- left to update and does nothing.
CREATE OR REPLACE FUNCTION public.review_photos_touch_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.reviews SET updated_at = now() WHERE id = NEW.review_id;
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.review_id IS DISTINCT FROM NEW.review_id) THEN
    UPDATE public.reviews SET updated_at = now() WHERE id = OLD.review_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.review_photos_touch_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS review_photos_touch_review ON public.review_photos;
CREATE TRIGGER review_photos_touch_review
  AFTER INSERT OR DELETE OR UPDATE OF review_id, position, private_public_id, media_asset_id ON public.review_photos
  FOR EACH ROW EXECUTE FUNCTION public.review_photos_touch_review();

-- An order refunded in full is no longer a verified purchase. (A partial refund
-- keeps it. Once cleared it does not come back by itself.)
CREATE OR REPLACE FUNCTION public.reviews_order_refunded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.reviews SET verified = false WHERE order_id = NEW.id AND verified;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reviews_order_refunded() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reviews_order_refunded ON public.orders;
CREATE TRIGGER reviews_order_refunded
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW
  WHEN (NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION public.reviews_order_refunded();
