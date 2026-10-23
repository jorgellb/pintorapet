-- Shipping: zones (national regions of Spain and international), weight bands,
-- product weights, shipping in quotes and orders, and the Correos connection.

-- ---------------------------------------------------------------------------
-- Product weight (grams, without packaging)
-- ---------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN weight_grams integer NOT NULL DEFAULT 100,
  ADD CONSTRAINT products_weight_positive CHECK (weight_grams > 0 AND weight_grams <= 30000);

UPDATE public.products p
SET weight_grams = CASE c.code
  WHEN 'greeting-cards' THEN 30
  WHEN 'coasters' THEN 90
  WHEN 'mugs' THEN 450
  ELSE 100
END
FROM public.categories c
WHERE c.id = p.category_id;

-- ---------------------------------------------------------------------------
-- Zones and weight bands
-- ---------------------------------------------------------------------------

CREATE TABLE public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  kind text NOT NULL,
  -- ISO 3166-1 alpha-2 codes; '*' matches any country not covered by another zone.
  countries text[] NOT NULL DEFAULT '{}',
  -- Only for Spain: peninsula, baleares, canarias, ceuta, melilla.
  regions text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  free_over_cents integer,
  delivery_es text NOT NULL DEFAULT '',
  delivery_en text NOT NULL DEFAULT '',
  correos_product text,
  customs boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_zones_kind_known CHECK (kind IN ('national', 'international')),
  CONSTRAINT shipping_zones_free_over_positive CHECK (free_over_cents IS NULL OR free_over_cents > 0),
  CONSTRAINT shipping_zones_regions_known CHECK (
    regions <@ ARRAY['peninsula', 'baleares', 'canarias', 'ceuta', 'melilla']::text[]
  )
);

CREATE TRIGGER shipping_zones_set_updated_at
  BEFORE UPDATE ON public.shipping_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.shipping_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.shipping_zones (id) ON DELETE CASCADE,
  max_grams integer NOT NULL,
  price_cents integer NOT NULL,
  CONSTRAINT shipping_rates_max_positive CHECK (max_grams > 0),
  CONSTRAINT shipping_rates_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT shipping_rates_zone_band_unique UNIQUE (zone_id, max_grams)
);

ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY shipping_zones_admin_all ON public.shipping_zones
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY shipping_rates_admin_all ON public.shipping_rates
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.shipping_zones, public.shipping_rates FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_zones, public.shipping_rates TO authenticated;
GRANT SELECT ON public.shipping_zones, public.shipping_rates TO service_role;

-- Prices or weights changing must invalidate open quotes.
CREATE OR REPLACE FUNCTION public.bump_shop_config_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.shop_settings SET config_version = config_version + 1 WHERE id = 1;
  RETURN NULL;
END;
$$;

CREATE TRIGGER shipping_zones_bump_config
  AFTER INSERT OR UPDATE OR DELETE ON public.shipping_zones
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_shop_config_version();
CREATE TRIGGER shipping_rates_bump_config
  AFTER INSERT OR UPDATE OR DELETE ON public.shipping_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_shop_config_version();
CREATE TRIGGER products_weight_bump_config
  AFTER UPDATE OF weight_grams ON public.products
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_shop_config_version();

-- Starting zones. Prices are a starting point for the admin to adjust.
DO $$
DECLARE
  v_zone uuid;
BEGIN
  INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, regions, position, free_over_cents, delivery_es, delivery_en, correos_product)
  VALUES ('Península', 'Mainland Spain', 'national', '{ES}', '{peninsula}', 10, 6000, '2–3 días laborables', '2–3 working days', 'PAAZE')
  RETURNING id INTO v_zone;
  INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents) VALUES
    (v_zone, 500, 490), (v_zone, 1000, 590), (v_zone, 2000, 690), (v_zone, 5000, 890);

  INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, regions, position, delivery_es, delivery_en, correos_product)
  VALUES ('Islas Baleares', 'Balearic Islands', 'national', '{ES}', '{baleares}', 20, '3–4 días laborables', '3–4 working days', 'PAAZE')
  RETURNING id INTO v_zone;
  INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents) VALUES
    (v_zone, 500, 690), (v_zone, 1000, 790), (v_zone, 2000, 990), (v_zone, 5000, 1390);

  INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, regions, position, delivery_es, delivery_en, correos_product, customs)
  VALUES ('Canarias, Ceuta y Melilla', 'Canary Islands, Ceuta and Melilla', 'national', '{ES}', '{canarias,ceuta,melilla}', 30, '4–7 días laborables', '4–7 working days', 'PAAZE', true)
  RETURNING id INTO v_zone;
  INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents) VALUES
    (v_zone, 500, 990), (v_zone, 1000, 1290), (v_zone, 2000, 1690), (v_zone, 5000, 2490);

  INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, position, delivery_es, delivery_en, correos_product)
  VALUES ('Unión Europea', 'European Union', 'international',
    '{PT,FR,DE,IT,NL,BE,LU,IE,AT,DK,SE,FI,PL,CZ,SK,HU,SI,HR,RO,BG,GR,CY,MT,EE,LV,LT}',
    40, '4–8 días laborables', '4–8 working days', 'S0107')
  RETURNING id INTO v_zone;
  INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents) VALUES
    (v_zone, 500, 990), (v_zone, 1000, 1390), (v_zone, 2000, 1890), (v_zone, 5000, 2990);

  INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, position, delivery_es, delivery_en, correos_product, customs)
  VALUES ('Resto de Europa', 'Rest of Europe', 'international',
    '{GB,CH,NO,IS,AD,MC,SM,LI,VA,GI,RS,BA,ME,MK,AL,MD,UA}',
    50, '5–10 días laborables', '5–10 working days', 'S0107', true)
  RETURNING id INTO v_zone;
  INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents) VALUES
    (v_zone, 500, 1490), (v_zone, 1000, 1990), (v_zone, 2000, 2690), (v_zone, 5000, 3990);

  INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, position, delivery_es, delivery_en, correos_product, customs)
  VALUES ('Resto del mundo', 'Rest of the world', 'international', '{*}', 60, '7–15 días laborables', '7–15 working days', 'S0107', true)
  RETURNING id INTO v_zone;
  INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents) VALUES
    (v_zone, 500, 1990), (v_zone, 1000, 2790), (v_zone, 2000, 3990), (v_zone, 5000, 5990);
END;
$$;

UPDATE public.shop_settings
SET shipping_config = jsonb_build_object('packagingGrams', 150, 'sender', '{}'::jsonb) || shipping_config
WHERE id = 1;

-- ---------------------------------------------------------------------------
-- Destination → zone → price
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.es_region(p_postal_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE left(regexp_replace(coalesce(p_postal_code, ''), '\D', '', 'g'), 2)
    WHEN '07' THEN 'baleares'
    WHEN '35' THEN 'canarias'
    WHEN '38' THEN 'canarias'
    WHEN '51' THEN 'ceuta'
    WHEN '52' THEN 'melilla'
    ELSE 'peninsula'
  END;
$$;

CREATE OR REPLACE FUNCTION public.shipping_zone_for(p_country text, p_postal_code text)
RETURNS public.shipping_zones
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT z.*
  FROM public.shipping_zones z
  WHERE z.active
    AND (
      (upper(p_country) = ANY (z.countries)
        AND (upper(p_country) <> 'ES' OR public.es_region(p_postal_code) = ANY (z.regions)))
      OR '*' = ANY (z.countries)
    )
  ORDER BY ('*' = ANY (z.countries)), z.position
  LIMIT 1;
$$;

-- Price for a set of cart lines delivered to one destination.
CREATE OR REPLACE FUNCTION public.shipping_quote(
  p_lines public.cart_line_input[],
  p_country text,
  p_postal_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_zone public.shipping_zones%ROWTYPE;
  v_weight integer;
  v_subtotal integer;
  v_packaging integer;
  v_price integer;
BEGIN
  IF p_country IS NULL OR p_country !~ '^[A-Za-z]{2}$' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'NO_DESTINATION');
  END IF;
  IF upper(p_country) = 'ES' AND coalesce(p_postal_code, '') !~ '^\s*\d{5}\s*$' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'POSTAL_CODE_REQUIRED');
  END IF;

  SELECT * INTO v_zone FROM public.shipping_zone_for(p_country, p_postal_code);
  IF v_zone.id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'NO_ZONE');
  END IF;

  SELECT coalesce((shipping_config->>'packagingGrams')::integer, 0)
  INTO v_packaging FROM public.shop_settings WHERE id = 1;

  SELECT coalesce(sum(p.weight_grams * (l).quantity), 0)::integer,
         coalesce(sum(p.price_cents * (l).quantity), 0)::integer
  INTO v_weight, v_subtotal
  FROM unnest(p_lines) AS l
  JOIN public.products p ON p.id = (l).product_id;

  v_weight := v_weight + v_packaging;

  SELECT price_cents INTO v_price
  FROM public.shipping_rates
  WHERE zone_id = v_zone.id AND max_grams >= v_weight
  ORDER BY max_grams
  LIMIT 1;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object(
      'available', false, 'reason', 'TOO_HEAVY',
      'zone_id', v_zone.id, 'zone_name_es', v_zone.name_es, 'zone_name_en', v_zone.name_en,
      'weight_grams', v_weight
    );
  END IF;

  IF v_zone.free_over_cents IS NOT NULL AND v_subtotal >= v_zone.free_over_cents THEN
    v_price := 0;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'zone_id', v_zone.id,
    'zone_name_es', v_zone.name_es,
    'zone_name_en', v_zone.name_en,
    'delivery_es', v_zone.delivery_es,
    'delivery_en', v_zone.delivery_en,
    'shipping_cents', v_price,
    'weight_grams', v_weight,
    'subtotal_cents', v_subtotal,
    'free_over_cents', v_zone.free_over_cents,
    'country', upper(p_country),
    'postal_code', nullif(btrim(coalesce(p_postal_code, '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shipping_quote(public.cart_line_input[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipping_quote(public.cart_line_input[], text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Quotes carry the destination and its shipping price
-- ---------------------------------------------------------------------------

ALTER TABLE public.checkout_quotes
  ADD COLUMN shipping_country text,
  ADD COLUMN shipping_postal_code text,
  ADD COLUMN shipping_zone_name text,
  ADD COLUMN shipping_weight_grams integer;

DROP FUNCTION IF EXISTS public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text);

CREATE OR REPLACE FUNCTION public.create_checkout_quote(
  p_cart_owner_hash text,
  p_locale public.locale_code,
  p_lines public.cart_line_input[],
  p_country text DEFAULT NULL,
  p_postal_code text DEFAULT NULL
)
RETURNS public.checkout_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_settings public.shop_settings%ROWTYPE;
  v_merged public.cart_line_input[];
  v_line public.cart_line_input;
  v_product public.products%ROWTYPE;
  v_tr public.product_translations%ROWTYPE;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_tax integer := 0;
  v_total integer;
  v_units integer := 0;
  v_fingerprint text := '';
  v_lines_json jsonb := '[]'::jsonb;
  v_quote public.checkout_quotes%ROWTYPE;
  v_qty integer;
  v_ship jsonb;
BEGIN
  IF p_cart_owner_hash IS NULL OR length(p_cart_owner_hash) < 16 THEN
    RAISE EXCEPTION 'INVALID_CART_OWNER' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO STRICT v_settings FROM public.shop_settings WHERE id = 1;

  SELECT COALESCE(array_agg(ROW(product_id, quantity)::public.cart_line_input), ARRAY[]::public.cart_line_input[])
  INTO v_merged
  FROM (
    SELECT (u).product_id AS product_id,
           LEAST(SUM((u).quantity)::integer, v_settings.cart_max_qty_per_line) AS quantity
    FROM unnest(p_lines) AS u
    GROUP BY (u).product_id
  ) s;

  IF coalesce(array_length(v_merged, 1), 0) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART' USING ERRCODE = 'P0001';
  END IF;

  IF array_length(v_merged, 1) > v_settings.cart_max_lines THEN
    RAISE EXCEPTION 'CART_TOO_MANY_LINES' USING ERRCODE = 'P0001';
  END IF;

  FOR v_line IN
    SELECT * FROM unnest(v_merged) AS l
    ORDER BY (l).product_id
  LOOP
    v_qty := (v_line).quantity;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > v_settings.cart_max_qty_per_line THEN
      RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_product FROM public.products WHERE id = (v_line).product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_product.status <> 'published' THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_tr
    FROM public.product_translations
    WHERE product_id = v_product.id AND locale = p_locale;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSLATION_MISSING' USING ERRCODE = 'P0001';
    END IF;

    v_units := v_units + v_qty;
    v_subtotal := v_subtotal + (v_product.price_cents * v_qty);
    v_fingerprint := v_fingerprint
      || v_product.id::text || ':'
      || v_product.price_version::text || ':'
      || v_product.price_cents::text || ';';

    v_lines_json := v_lines_json || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'quantity', v_qty,
        'unit_price_cents', v_product.price_cents,
        'line_subtotal_cents', v_product.price_cents * v_qty,
        'price_version', v_product.price_version,
        'title', v_tr.title,
        'sku', v_product.sku,
        'slug', v_tr.slug,
        'weight_grams', v_product.weight_grams
      )
    );
  END LOOP;

  IF v_units > v_settings.cart_max_units THEN
    RAISE EXCEPTION 'CART_TOO_MANY_UNITS' USING ERRCODE = 'P0001';
  END IF;

  IF p_country IS NOT NULL THEN
    v_ship := public.shipping_quote(v_merged, p_country, p_postal_code);
    IF NOT (v_ship->>'available')::boolean THEN
      RAISE EXCEPTION 'SHIPPING_%', v_ship->>'reason' USING ERRCODE = 'P0001';
    END IF;
    v_shipping := (v_ship->>'shipping_cents')::integer;
  END IF;

  v_fingerprint := v_fingerprint || 'cfg:' || v_settings.config_version::text;
  v_total := v_subtotal + v_shipping + v_tax;

  INSERT INTO public.checkout_quotes (
    cart_owner_hash, locale, lines, price_fingerprint, config_version,
    subtotal_cents, shipping_cents, tax_cents, total_cents, currency,
    shipping_zone, shipping_country, shipping_postal_code, shipping_zone_name,
    shipping_weight_grams, expires_at
  ) VALUES (
    p_cart_owner_hash, p_locale, v_lines_json,
    encode(digest(v_fingerprint, 'sha256'), 'hex'), v_settings.config_version,
    v_subtotal, v_shipping, v_tax, v_total, 'EUR',
    v_ship->>'zone_id', v_ship->>'country', v_ship->>'postal_code',
    CASE WHEN p_locale = 'es' THEN v_ship->>'zone_name_es' ELSE v_ship->>'zone_name_en' END,
    (v_ship->>'weight_grams')::integer,
    now() + make_interval(secs => v_settings.quote_ttl_seconds)
  )
  RETURNING * INTO v_quote;

  RETURN v_quote;
END;
$$;

REVOKE ALL ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Orders carry the destination, the parcel and the carrier shipment
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN shipping_zone_id uuid REFERENCES public.shipping_zones (id) ON DELETE SET NULL,
  ADD COLUMN shipping_zone_name text,
  ADD COLUMN shipping_country text,
  ADD COLUMN shipping_postal_code text,
  ADD COLUMN shipping_weight_grams integer,
  -- false when the paid address falls outside the zone that was charged.
  ADD COLUMN shipping_destination_ok boolean,
  ADD COLUMN carrier text,
  ADD COLUMN carrier_shipment_code text,
  ADD COLUMN tracking_code text,
  ADD COLUMN label_created_at timestamptz,
  ADD COLUMN shipped_at timestamptz;

-- No checkout without a priced destination.
CREATE OR REPLACE FUNCTION public.checkout_attempts_require_shipping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_quote public.checkout_quotes%ROWTYPE;
BEGIN
  SELECT * INTO v_quote FROM public.checkout_quotes WHERE id = NEW.quote_id;
  IF v_quote.shipping_country IS NULL THEN
    RAISE EXCEPTION 'SHIPPING_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER checkout_attempts_require_shipping
  BEFORE INSERT ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.checkout_attempts_require_shipping();

CREATE OR REPLACE FUNCTION public.checkout_attempts_copy_shipping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.orders o
  SET shipping_zone_id = q.shipping_zone::uuid,
      shipping_zone_name = q.shipping_zone_name,
      shipping_country = q.shipping_country,
      shipping_postal_code = q.shipping_postal_code,
      shipping_weight_grams = q.shipping_weight_grams
  FROM public.checkout_quotes q
  WHERE q.id = NEW.quote_id AND o.id = NEW.order_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER checkout_attempts_copy_shipping
  AFTER INSERT ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.checkout_attempts_copy_shipping();

CREATE OR REPLACE FUNCTION public.orders_check_destination()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_country text := upper(coalesce(NEW.shipping_address->>'country', ''));
  v_postal text := coalesce(NEW.shipping_address->>'postal_code', '');
BEGIN
  IF NEW.shipping_address IS NULL OR NEW.shipping_country IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.shipping_destination_ok := v_country = NEW.shipping_country
    AND (v_country <> 'ES' OR public.es_region(v_postal) = public.es_region(NEW.shipping_postal_code));
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_check_destination
  BEFORE INSERT OR UPDATE OF shipping_address ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_check_destination();

-- ---------------------------------------------------------------------------
-- Save a zone with its bands in one go (admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_shipping_zone(p_zone jsonb, p_rates jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid := nullif(p_zone->>'id', '')::uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.shipping_zones (name_es, name_en, kind, countries, regions, active, position,
      free_over_cents, delivery_es, delivery_en, correos_product, customs)
    VALUES (
      p_zone->>'nameEs', p_zone->>'nameEn', p_zone->>'kind',
      ARRAY(SELECT upper(jsonb_array_elements_text(coalesce(p_zone->'countries', '[]')))),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_zone->'regions', '[]'))),
      coalesce((p_zone->>'active')::boolean, true),
      coalesce((p_zone->>'position')::integer, (SELECT coalesce(max(position), 0) + 10 FROM public.shipping_zones)),
      nullif(p_zone->>'freeOverCents', '')::integer,
      coalesce(p_zone->>'deliveryEs', ''), coalesce(p_zone->>'deliveryEn', ''),
      nullif(p_zone->>'correosProduct', ''),
      coalesce((p_zone->>'customs')::boolean, false)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.shipping_zones SET
      name_es = p_zone->>'nameEs',
      name_en = p_zone->>'nameEn',
      kind = p_zone->>'kind',
      countries = ARRAY(SELECT upper(jsonb_array_elements_text(coalesce(p_zone->'countries', '[]')))),
      regions = ARRAY(SELECT jsonb_array_elements_text(coalesce(p_zone->'regions', '[]'))),
      active = coalesce((p_zone->>'active')::boolean, active),
      free_over_cents = nullif(p_zone->>'freeOverCents', '')::integer,
      delivery_es = coalesce(p_zone->>'deliveryEs', ''),
      delivery_en = coalesce(p_zone->>'deliveryEn', ''),
      correos_product = nullif(p_zone->>'correosProduct', ''),
      customs = coalesce((p_zone->>'customs')::boolean, customs)
    WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ZONE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_rates IS NOT NULL THEN
    DELETE FROM public.shipping_rates WHERE zone_id = v_id;
    INSERT INTO public.shipping_rates (zone_id, max_grams, price_cents)
    SELECT v_id, (r->>'maxGrams')::integer, (r->>'priceCents')::integer
    FROM jsonb_array_elements(p_rates) AS r;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_shipping_zone(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_shipping_zone(jsonb, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Carrier accounts (Correos). Credentials live in Vault as shipping.<carrier>.<name>.
-- ---------------------------------------------------------------------------

CREATE TABLE public.shipping_carriers (
  carrier text PRIMARY KEY,
  mode text NOT NULL,
  contract_number text,
  client_number text,
  labeller_code text,
  oauth_client_id text,
  gateway_client_id text,
  key_hint text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_carriers_known CHECK (carrier IN ('correos')),
  CONSTRAINT shipping_carriers_mode_known CHECK (mode IN ('test', 'live'))
);

CREATE TRIGGER shipping_carriers_set_updated_at
  BEFORE UPDATE ON public.shipping_carriers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.shipping_carriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipping_carriers_admin_select ON public.shipping_carriers
  FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.shipping_carriers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shipping_carriers TO authenticated;
GRANT SELECT ON public.shipping_carriers TO service_role;

CREATE OR REPLACE FUNCTION public.admin_connect_carrier(p_carrier text, p_settings jsonb, p_secrets jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text;
  v_value text;
  v_name text;
  v_existing uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.shipping_carriers AS sc (
    carrier, mode, contract_number, client_number, labeller_code,
    oauth_client_id, gateway_client_id, key_hint, connected_at
  ) VALUES (
    p_carrier, p_settings->>'mode', p_settings->>'contractNumber', p_settings->>'clientNumber',
    p_settings->>'labellerCode', p_settings->>'oauthClientId', p_settings->>'gatewayClientId',
    p_settings->>'keyHint', now()
  )
  ON CONFLICT (carrier) DO UPDATE SET
    mode = EXCLUDED.mode,
    contract_number = EXCLUDED.contract_number,
    client_number = EXCLUDED.client_number,
    labeller_code = EXCLUDED.labeller_code,
    oauth_client_id = EXCLUDED.oauth_client_id,
    gateway_client_id = EXCLUDED.gateway_client_id,
    key_hint = EXCLUDED.key_hint,
    connected_at = now();

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(coalesce(p_secrets, '{}'::jsonb))
  LOOP
    v_name := 'shipping.' || p_carrier || '.' || v_key;
    SELECT id INTO v_existing FROM vault.secrets WHERE name = v_name;
    IF v_value IS NULL OR v_value = '' THEN
      DELETE FROM vault.secrets WHERE name = v_name;
    ELSIF v_existing IS NULL THEN
      PERFORM vault.create_secret(v_value, v_name);
    ELSE
      PERFORM vault.update_secret(v_existing, v_value);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_disconnect_carrier(p_carrier text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM vault.secrets WHERE name LIKE 'shipping.' || p_carrier || '.%';
  DELETE FROM public.shipping_carriers WHERE carrier = p_carrier;
END;
$$;

CREATE OR REPLACE FUNCTION public.carrier_secrets(p_carrier text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    jsonb_object_agg(substr(name, length('shipping.' || p_carrier || '.') + 1), decrypted_secret),
    '{}'::jsonb
  )
  FROM vault.decrypted_secrets
  WHERE name LIKE 'shipping.' || p_carrier || '.%';
$$;

REVOKE ALL ON FUNCTION public.admin_connect_carrier(text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_disconnect_carrier(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carrier_secrets(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_connect_carrier(text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_disconnect_carrier(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carrier_secrets(text) TO service_role;

-- New products start with their category's usual weight; variants with their parent's.
CREATE OR REPLACE FUNCTION public.products_default_weight()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT weight_grams INTO NEW.weight_grams FROM public.products WHERE id = NEW.parent_id;
  ELSE
    SELECT CASE code
      WHEN 'greeting-cards' THEN 30
      WHEN 'coasters' THEN 90
      WHEN 'mugs' THEN 450
      ELSE NEW.weight_grams
    END INTO NEW.weight_grams
    FROM public.categories WHERE id = NEW.category_id;
  END IF;
  NEW.weight_grams := coalesce(NEW.weight_grams, 100);
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_default_weight
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_default_weight();


-- Guests see the tracking number of their order.
CREATE OR REPLACE FUNCTION public.lookup_guest_order(
  p_reference text,
  p_access_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_hash text;
  v_items jsonb;
BEGIN
  IF p_reference IS NULL OR p_access_token IS NULL OR length(p_access_token) < 24 THEN
    RAISE EXCEPTION 'INVALID_LOOKUP' USING ERRCODE = 'P0001';
  END IF;

  v_hash := encode(digest(p_access_token, 'sha256'), 'hex');

  SELECT * INTO v_order
  FROM public.orders
  WHERE reference = p_reference
  LIMIT 1;

  IF NOT FOUND OR v_order.access_token_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'ORDER_LOOKUP_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'title', oi.product_title,
      'sku', oi.product_sku,
      'quantity', oi.quantity,
      'unit_price_cents', oi.unit_price_cents,
      'line_subtotal_cents', oi.line_subtotal_cents
    )
    ORDER BY oi.created_at
  ), '[]'::jsonb)
  INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'reference', v_order.reference,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'locale', v_order.locale,
    'currency', v_order.currency,
    'subtotal_cents', v_order.subtotal_cents,
    'shipping_cents', v_order.shipping_cents,
    'tax_cents', v_order.tax_cents,
    'total_cents', v_order.total_cents,
    'customer_email', v_order.customer_email,
    'customer_name', v_order.customer_name,
    'paid_at', v_order.paid_at,
    'created_at', v_order.created_at,
    'shipping_zone_name', v_order.shipping_zone_name,
    'carrier', v_order.carrier,
    'tracking_code', v_order.tracking_code,
    'shipped_at', v_order.shipped_at,
    'items', v_items
  );
END;
$$;

-- pgcrypto's digest() lives in the extensions schema.
ALTER FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text)
  SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.reserve_checkout(uuid, text, uuid, text, text)
  SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.set_order_access_token(uuid, text)
  SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.lookup_guest_order(text, text)
  SET search_path = pg_catalog, public, extensions;
