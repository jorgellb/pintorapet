-- Invoices: product VAT, destination regime, quote discounts, and Verifactu issuance.
-- SECURITY DEFINER functions keep search_path = pg_catalog, public, extensions.

-- ---------------------------------------------------------------------------
-- 2a. Product VAT and helpers
-- ---------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS vat_rate numeric(4,2) NOT NULL DEFAULT 21;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_vat_rate_ok') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_vat_rate_ok CHECK (vat_rate IN (0, 4, 10, 21));
    UPDATE public.products p
    SET vat_rate = CASE c.code WHEN 'originals' THEN 10 ELSE 21 END
    FROM public.categories c
    WHERE c.id = p.category_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.products_default_vat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT vat_rate INTO NEW.vat_rate FROM public.products WHERE id = NEW.parent_id;
  ELSE
    SELECT CASE code WHEN 'originals' THEN 10 ELSE 21 END
      INTO NEW.vat_rate
    FROM public.categories WHERE id = NEW.category_id;
  END IF;
  NEW.vat_rate := coalesce(NEW.vat_rate, 21);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_default_vat ON public.products;
CREATE TRIGGER products_default_vat
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_default_vat();

CREATE OR REPLACE FUNCTION public.net_cents(p_gross integer, p_rate numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN p_rate = 0 THEN p_gross
              ELSE round(p_gross / (1 + p_rate / 100.0))::integer
         END;
$$;

CREATE OR REPLACE FUNCTION public.is_eu_country(p_country text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT upper(p_country) IN (
    'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU',
    'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'
  );
$$;

CREATE OR REPLACE FUNCTION public.vat_regime(p_country text, p_postal_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_country IS NULL OR p_country !~* '^[A-Za-z]{2}$' THEN NULL
    WHEN upper(p_country) = 'ES'
         AND public.es_region(p_postal_code) IN ('canarias', 'ceuta', 'melilla')
      THEN 'no_vat'
    WHEN public.is_eu_country(p_country) THEN 'es_vat'
    ELSE 'no_vat'
  END;
$$;

CREATE OR REPLACE FUNCTION public.vat_exemption_note(
  p_regime text, p_country text, p_postal text, p_locale text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_regime IS DISTINCT FROM 'no_vat' THEN NULL
    WHEN upper(p_country) = 'ES' AND public.es_region(p_postal) = 'canarias'
      THEN CASE p_locale WHEN 'en' THEN 'Supply not subject to Spanish VAT (Canary Islands).'
                         ELSE 'Entrega no sujeta al IVA (Canarias).' END
    WHEN upper(p_country) = 'ES' AND public.es_region(p_postal) = 'ceuta'
      THEN CASE p_locale WHEN 'en' THEN 'Supply not subject to Spanish VAT (Ceuta).'
                         ELSE 'Entrega no sujeta al IVA (Ceuta).' END
    WHEN upper(p_country) = 'ES' AND public.es_region(p_postal) = 'melilla'
      THEN CASE p_locale WHEN 'en' THEN 'Supply not subject to Spanish VAT (Melilla).'
                         ELSE 'Entrega no sujeta al IVA (Melilla).' END
    ELSE CASE p_locale WHEN 'en' THEN 'Export exempt from VAT.'
                       ELSE 'Exportación exenta de IVA.' END
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Spanish tax id (NIF / NIE / CIF), same rules as src/lib/domain/taxId.ts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spanish_tax_id_ok(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id text;
  v_digits text;
  v_type text;
  v_control text;
  v_sum integer := 0;
  v_i integer;
  v_n integer;
  v_doubled integer;
  v_check integer;
  v_dni constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  v_cif constant text := 'JABCDEFGHI';
BEGIN
  IF p_value IS NULL THEN
    RETURN false;
  END IF;

  v_id := upper(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g'));
  IF length(v_id) = 11 AND left(v_id, 2) = 'ES' THEN
    v_id := substr(v_id, 3);
  END IF;
  IF length(v_id) <> 9 THEN
    RETURN false;
  END IF;

  IF v_id ~ '^[0-9]{8}[A-Z]$' THEN
    RETURN substr(v_dni, ((substr(v_id, 1, 8)::bigint % 23) + 1)::integer, 1) = right(v_id, 1);
  END IF;

  IF v_id ~ '^[XYZ][0-9]{7}[A-Z]$' THEN
    v_digits := (CASE left(v_id, 1) WHEN 'X' THEN '0' WHEN 'Y' THEN '1' ELSE '2' END)
             || substr(v_id, 2, 7);
    RETURN substr(v_dni, ((v_digits::bigint % 23) + 1)::integer, 1) = right(v_id, 1);
  END IF;

  IF v_id !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' THEN
    RETURN false;
  END IF;

  v_type := left(v_id, 1);
  v_digits := substr(v_id, 2, 7);
  v_control := right(v_id, 1);
  FOR v_i IN 0..6 LOOP
    v_n := substr(v_digits, v_i + 1, 1)::integer;
    IF v_i % 2 = 0 THEN
      v_doubled := v_n * 2;
      v_sum := v_sum + (v_doubled / 10) + (v_doubled % 10);
    ELSE
      v_sum := v_sum + v_n;
    END IF;
  END LOOP;

  v_check := (10 - (v_sum % 10)) % 10;
  IF strpos('PQRSNW', v_type) > 0 THEN
    RETURN v_control = substr(v_cif, v_check + 1, 1);
  ELSIF strpos('ABEH', v_type) > 0 THEN
    RETURN v_control = v_check::text;
  ELSE
    RETURN v_control = v_check::text OR v_control = substr(v_cif, v_check + 1, 1);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2c. invoice_config
-- ---------------------------------------------------------------------------

ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS invoice_config jsonb NOT NULL DEFAULT '{
    "issuerName":"","issuerNif":"","issuerAddress":"","issuerPostalCode":"",
    "issuerCity":"","issuerKind":"autonomo","simplifiedPrefix":"S","fullPrefix":"F",
    "shippingVatRate":21,"verifactuEnabled":false
  }'::jsonb;

CREATE OR REPLACE FUNCTION public.invoice_config_complete()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    length(btrim(invoice_config->>'issuerName')) > 0
    AND public.spanish_tax_id_ok(invoice_config->>'issuerNif')
    AND length(btrim(invoice_config->>'issuerAddress')) > 0
    AND length(btrim(invoice_config->>'issuerPostalCode')) > 0
    AND length(btrim(invoice_config->>'issuerCity')) > 0,
    false)
  FROM public.shop_settings WHERE id = 1;
$$;

-- ---------------------------------------------------------------------------
-- 2d. shipping_quote — charged shipping, plus VAT regime and discount
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.shipping_quote(
  p_lines public.cart_line_input[],
  p_country text,
  p_postal_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_zone public.shipping_zones%ROWTYPE;
  v_weight integer;
  v_subtotal integer;
  v_packaging integer;
  v_price integer;
  v_regime text;
  v_ship_rate numeric;
  v_subtotal_net integer;
  v_discount integer := 0;
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

  -- v_subtotal stays catalog-gross (used for free_over).
  v_regime := public.vat_regime(p_country, p_postal_code);

  SELECT coalesce(sum(public.net_cents(p.price_cents, p.vat_rate) * (l).quantity), 0)::integer
  INTO v_subtotal_net
  FROM unnest(p_lines) AS l
  JOIN public.products p ON p.id = (l).product_id;

  SELECT coalesce((invoice_config->>'shippingVatRate')::numeric, 21)
  INTO v_ship_rate FROM public.shop_settings WHERE id = 1;

  IF v_regime = 'no_vat' THEN
    v_discount := (v_subtotal - v_subtotal_net)
               + (v_price - public.net_cents(v_price, v_ship_rate));
    v_price := public.net_cents(v_price, v_ship_rate);
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
    'postal_code', nullif(btrim(coalesce(p_postal_code, '')), ''),
    'vat_regime', v_regime,
    'vat_discount_cents', v_discount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shipping_quote(public.cart_line_input[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipping_quote(public.cart_line_input[], text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2e. Quotes and reserve
-- ---------------------------------------------------------------------------

ALTER TABLE public.checkout_quotes
  ADD COLUMN IF NOT EXISTS vat_regime text;

ALTER TABLE public.checkout_quotes
  ADD COLUMN IF NOT EXISTS vat_discount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.checkout_quotes
  ADD COLUMN IF NOT EXISTS shipping_vat_rate numeric(4,2) NOT NULL DEFAULT 21;

ALTER TABLE public.checkout_quotes
  ADD COLUMN IF NOT EXISTS invoice_customer jsonb;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vat_regime text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_customer jsonb;

DROP FUNCTION IF EXISTS public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text);

CREATE OR REPLACE FUNCTION public.create_checkout_quote(
  p_cart_owner_hash text,
  p_locale public.locale_code,
  p_lines public.cart_line_input[],
  p_country text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_invoice_customer jsonb DEFAULT NULL
)
RETURNS public.checkout_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
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
  v_catalog integer;
  v_rate numeric(4,2);
  v_unit integer;
  v_regime text;
  v_ship_rate numeric := 21;
  v_discount integer := 0;
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

  v_regime := public.vat_regime(p_country, p_postal_code);

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

    v_catalog := v_product.price_cents;
    v_rate := v_product.vat_rate;
    v_unit := v_catalog;
    IF v_regime = 'no_vat' THEN
      v_unit := public.net_cents(v_catalog, v_rate);
    END IF;

    v_units := v_units + v_qty;
    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_fingerprint := v_fingerprint || v_product.id::text || ':'
      || v_product.price_version::text || ':'
      || v_catalog::text || ':' || v_rate::text || ';';
    v_lines_json := v_lines_json || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'quantity', v_qty,
      'catalog_price_cents', v_catalog,
      'unit_price_cents', v_unit,
      'line_subtotal_cents', v_unit * v_qty,
      'vat_rate', v_rate,
      'price_version', v_product.price_version,
      'title', v_tr.title,
      'sku', v_product.sku,
      'slug', v_tr.slug,
      'weight_grams', v_product.weight_grams
    ));
  END LOOP;

  IF v_units > v_settings.cart_max_units THEN
    RAISE EXCEPTION 'CART_TOO_MANY_UNITS' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce((invoice_config->>'shippingVatRate')::numeric, 21)
  INTO v_ship_rate
  FROM public.shop_settings
  WHERE id = 1;

  IF p_country IS NOT NULL THEN
    v_ship := public.shipping_quote(v_merged, p_country, p_postal_code);
    IF NOT (v_ship->>'available')::boolean THEN
      RAISE EXCEPTION 'SHIPPING_%', v_ship->>'reason' USING ERRCODE = 'P0001';
    END IF;
    v_shipping := (v_ship->>'shipping_cents')::integer;
    v_discount := coalesce((v_ship->>'vat_discount_cents')::integer, 0);
  END IF;

  v_fingerprint := v_fingerprint || 'cfg:' || v_settings.config_version::text;
  v_total := v_subtotal + v_shipping + v_tax;

  INSERT INTO public.checkout_quotes (
    cart_owner_hash, locale, lines, price_fingerprint, config_version,
    subtotal_cents, shipping_cents, tax_cents, total_cents, currency,
    shipping_zone, shipping_country, shipping_postal_code, shipping_zone_name,
    shipping_weight_grams, expires_at,
    vat_regime, vat_discount_cents, shipping_vat_rate, invoice_customer
  ) VALUES (
    p_cart_owner_hash, p_locale, v_lines_json,
    encode(digest(v_fingerprint, 'sha256'), 'hex'), v_settings.config_version,
    v_subtotal, v_shipping, v_tax, v_total, 'EUR',
    v_ship->>'zone_id', v_ship->>'country', v_ship->>'postal_code',
    CASE WHEN p_locale = 'es' THEN v_ship->>'zone_name_es' ELSE v_ship->>'zone_name_en' END,
    (v_ship->>'weight_grams')::integer,
    now() + make_interval(secs => v_settings.quote_ttl_seconds),
    v_regime, v_discount, coalesce(v_ship_rate, 21), p_invoice_customer
  )
  RETURNING * INTO v_quote;

  RETURN v_quote;
END;
$$;

REVOKE ALL ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text, jsonb) TO service_role;

-- Price check uses the catalog price. The fingerprint includes vat_rate so a
-- rate change still invalidates an open quote (the charged unit depends on it).
CREATE OR REPLACE FUNCTION public.reserve_checkout(
  p_attempt_id uuid,
  p_cart_owner_hash text,
  p_quote_id uuid,
  p_request_hash text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_settings public.shop_settings%ROWTYPE;
  v_quote public.checkout_quotes%ROWTYPE;
  v_existing public.checkout_attempts%ROWTYPE;
  v_line jsonb;
  v_product_id uuid;
  v_qty integer;
  v_product public.products%ROWTYPE;
  v_inv public.inventory%ROWTYPE;
  v_available integer;
  v_order_id uuid;
  v_reference text;
  v_access_hash text;
  v_expires_at timestamptz;
  v_fingerprint text := '';
  v_subtotal integer := 0;
  v_item_id uuid;
  v_cover uuid;
  v_sorted_ids uuid[];
BEGIN
  IF p_attempt_id IS NULL OR p_request_hash IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM public.checkout_attempts WHERE id = p_attempt_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'ATTEMPT_HASH_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'attempt_id', v_existing.id,
      'order_id', v_existing.order_id,
      'status', v_existing.status,
      'replay', true
    );
  END IF;

  SELECT * INTO STRICT v_settings FROM public.shop_settings WHERE id = 1 FOR SHARE;

  IF NOT v_settings.sales_enabled OR NOT v_settings.payments_enabled THEN
    RAISE EXCEPTION 'SALES_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_quote
  FROM public.checkout_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUOTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_quote.cart_owner_hash <> p_cart_owner_hash THEN
    RAISE EXCEPTION 'QUOTE_OWNER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_quote.expires_at < now() THEN
    RAISE EXCEPTION 'QUOTE_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_quote.config_version <> v_settings.config_version THEN
    RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg((elem->>'product_id')::uuid ORDER BY (elem->>'product_id')::uuid)
  INTO v_sorted_ids
  FROM jsonb_array_elements(v_quote.lines) AS elem;

  FOREACH v_product_id IN ARRAY v_sorted_ids
  LOOP
    SELECT elem INTO v_line
    FROM jsonb_array_elements(v_quote.lines) AS elem
    WHERE (elem->>'product_id')::uuid = v_product_id
    LIMIT 1;

    v_qty := (v_line->>'quantity')::integer;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND OR v_product.status <> 'published' OR NOT v_product.sale_enabled THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    IF v_product.price_cents
         <> coalesce((v_line->>'catalog_price_cents')::integer, (v_line->>'unit_price_cents')::integer)
       OR v_product.price_version <> (v_line->>'price_version')::integer THEN
      RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_inv
    FROM public.inventory
    WHERE product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND OR v_inv.inventory_mode = 'unverified' OR v_inv.verified_at IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_UNVERIFIED' USING ERRCODE = 'P0001';
    END IF;

    IF v_inv.inventory_mode = 'tracked' THEN
      v_available := v_inv.stock_on_hand - v_inv.stock_reserved;
      IF v_available < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_fingerprint := v_fingerprint
      || v_product.id::text || ':'
      || v_product.price_version::text || ':'
      || v_product.price_cents::text || ':'
      || v_product.vat_rate::text || ';';
    v_subtotal := v_subtotal + (v_product.price_cents * v_qty);
  END LOOP;

  v_fingerprint := v_fingerprint || 'cfg:' || v_settings.config_version::text;
  IF encode(digest(v_fingerprint, 'sha256'), 'hex') <> v_quote.price_fingerprint THEN
    RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE = 'P0001';
  END IF;

  v_expires_at := now() + make_interval(mins => v_settings.reservation_minutes);
  v_reference := 'PD-' || upper(substr(replace(p_attempt_id::text, '-', ''), 1, 10));
  v_access_hash := encode(
    digest(p_attempt_id::text || ':' || p_cart_owner_hash || ':' || gen_random_uuid()::text, 'sha256'),
    'hex'
  );

  INSERT INTO public.orders (
    reference,
    payment_status,
    fulfillment_status,
    locale,
    currency,
    subtotal_cents,
    shipping_cents,
    tax_cents,
    total_cents,
    access_token_hash
  ) VALUES (
    v_reference,
    'pending_session',
    'unfulfilled',
    v_quote.locale,
    'EUR',
    v_quote.subtotal_cents,
    v_quote.shipping_cents,
    v_quote.tax_cents,
    v_quote.total_cents,
    v_access_hash
  )
  RETURNING id INTO v_order_id;

  FOR v_line IN
    SELECT elem
    FROM jsonb_array_elements(v_quote.lines) AS elem
    ORDER BY (elem->>'product_id')::uuid
  LOOP
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'quantity')::integer;

    SELECT media_asset_id INTO v_cover
    FROM public.product_images
    WHERE product_id = v_product_id
    ORDER BY is_cover DESC, position ASC
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_title,
      product_sku,
      unit_price_cents,
      quantity,
      line_subtotal_cents,
      media_asset_id
    ) VALUES (
      v_order_id,
      v_product_id,
      v_line->>'title',
      v_line->>'sku',
      (v_line->>'unit_price_cents')::integer,
      v_qty,
      (v_line->>'line_subtotal_cents')::integer,
      v_cover
    )
    RETURNING id INTO v_item_id;

    UPDATE public.inventory
    SET
      stock_reserved = stock_reserved + v_qty,
      version = version + 1
    WHERE product_id = v_product_id;
  END LOOP;

  INSERT INTO public.checkout_attempts (
    id,
    cart_owner_hash,
    quote_id,
    request_hash,
    order_id,
    status,
    stripe_idempotency_key,
    session_expires_at
  ) VALUES (
    p_attempt_id,
    p_cart_owner_hash,
    p_quote_id,
    p_request_hash,
    v_order_id,
    'creating_session',
    p_idempotency_key,
    v_expires_at
  );

  INSERT INTO public.stock_reservations (
    checkout_attempt_id,
    product_id,
    quantity,
    status,
    expires_at
  )
  SELECT
    p_attempt_id,
    (elem->>'product_id')::uuid,
    (elem->>'quantity')::integer,
    'active',
    v_expires_at
  FROM jsonb_array_elements(v_quote.lines) AS elem;

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'order_id', v_order_id,
    'reference', v_reference,
    'status', 'creating_session',
    'expires_at', v_expires_at,
    'total_cents', v_quote.total_cents,
    'currency', 'EUR',
    'locale', v_quote.locale,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.checkout_attempts_copy_shipping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  UPDATE public.orders o
  SET shipping_zone_id = q.shipping_zone::uuid,
      shipping_zone_name = q.shipping_zone_name,
      shipping_country = q.shipping_country,
      shipping_postal_code = q.shipping_postal_code,
      shipping_weight_grams = q.shipping_weight_grams,
      vat_regime = q.vat_regime,
      invoice_customer = q.invoice_customer
  FROM public.checkout_quotes q
  WHERE q.id = NEW.quote_id AND o.id = NEW.order_id;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2f. Invoice tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoice_series (
  code text NOT NULL,
  year integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (code, year)
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  kind text NOT NULL CHECK (kind IN ('simplified', 'full')),
  series text NOT NULL,
  number integer NOT NULL CHECK (number >= 1),
  full_number text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  operation_date date NOT NULL,
  issuer jsonb NOT NULL,
  customer jsonb,
  lines jsonb NOT NULL,
  breakdown jsonb NOT NULL,
  base_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  total_cents integer NOT NULL,
  vat_regime text NOT NULL,
  exemption_note text,
  locale public.locale_code NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  record_generated_at timestamptz NOT NULL,
  qr_url text NOT NULL,
  aeat_status text NOT NULL DEFAULT 'not_sent'
    CHECK (aeat_status IN ('not_sent', 'pending', 'accepted', 'rejected')),
  aeat_response jsonb
);

CREATE OR REPLACE FUNCTION public.invoices_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF to_jsonb(NEW) - 'aeat_status' - 'aeat_response'
     IS DISTINCT FROM to_jsonb(OLD) - 'aeat_status' - 'aeat_response' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_immutable ON public.invoices;
CREATE TRIGGER invoices_immutable
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_immutable();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_admin_read ON public.invoices;
CREATE POLICY invoices_admin_read ON public.invoices
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS invoice_series_admin_read ON public.invoice_series;
CREATE POLICY invoice_series_admin_read ON public.invoice_series
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.invoices, public.invoice_series FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoices, public.invoice_series TO authenticated;
GRANT ALL ON public.invoices, public.invoice_series TO service_role;

-- ---------------------------------------------------------------------------
-- 2g. Hash and issue
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verifactu_amount(p_cents integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT to_char(p_cents / 100.0, 'FM999999990.00');
$$;

CREATE OR REPLACE FUNCTION public.verifactu_hash(
  p_issuer_nif text, p_number text, p_issued_on text, p_kind text,
  p_vat_cents integer, p_total_cents integer, p_prev text, p_generated_at text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT upper(encode(digest(convert_to(
    'IDEmisorFactura=' || btrim(p_issuer_nif)
    || '&NumSerieFactura=' || btrim(p_number)
    || '&FechaExpedicionFactura=' || btrim(p_issued_on)
    || '&TipoFactura=' || p_kind
    || '&CuotaTotal=' || public.verifactu_amount(p_vat_cents)
    || '&ImporteTotal=' || public.verifactu_amount(p_total_cents)
    || '&Huella=' || coalesce(btrim(p_prev), '')
    || '&FechaHoraHusoGenRegistro=' || btrim(p_generated_at),
    'UTF8'), 'sha256'), 'hex'));
$$;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing uuid;
  v_cfg jsonb;
  v_kind text;
  v_prefix text;
  v_year integer;
  v_number integer;
  v_full text;
  v_quote_lines jsonb;
  v_quote_ship_rate numeric;
  v_item record;
  v_rate numeric;
  v_line_total integer;
  v_line_base integer;
  v_line_vat integer;
  v_key text;
  v_lines jsonb := '[]'::jsonb;
  v_breakdown jsonb := '{}'::jsonb;
  v_base integer := 0;
  v_vat integer := 0;
  v_total integer;
  v_regime text;
  v_issuer jsonb;
  v_customer jsonb;
  v_note text;
  v_prev text;
  v_at timestamptz;
  v_local timestamp;
  v_utc timestamp;
  v_off interval;
  v_stamp text;
  v_issued_on text;
  v_tipo text;
  v_hash text;
  v_qr text;
  v_id uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'INVOICE_ORDER_NOT_PAID' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing FROM public.invoices WHERE order_id = v_order.id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF coalesce(public.invoice_config_complete(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'INVOICE_CONFIG_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  SELECT invoice_config INTO v_cfg FROM public.shop_settings WHERE id = 1;

  v_kind := CASE WHEN v_order.invoice_customer IS NOT NULL THEN 'full' ELSE 'simplified' END;
  v_prefix := CASE
    WHEN v_kind = 'full' THEN coalesce(nullif(btrim(v_cfg->>'fullPrefix'), ''), 'F')
    ELSE coalesce(nullif(btrim(v_cfg->>'simplifiedPrefix'), ''), 'S')
  END;
  v_year := extract(year FROM timezone('Europe/Madrid', now()))::integer;

  INSERT INTO public.invoice_series (code, year)
  VALUES (v_prefix, v_year)
  ON CONFLICT (code, year) DO NOTHING;

  SELECT next_number INTO v_number
  FROM public.invoice_series
  WHERE code = v_prefix AND year = v_year
  FOR UPDATE;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'INVOICE_SERIES_MISSING' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoice_series
  SET next_number = v_number + 1
  WHERE code = v_prefix AND year = v_year;

  v_full := v_prefix || v_year::text || '-' || lpad(v_number::text, 4, '0');
  v_regime := coalesce(v_order.vat_regime, 'es_vat');

  SELECT q.lines, q.shipping_vat_rate
  INTO v_quote_lines, v_quote_ship_rate
  FROM public.checkout_attempts a
  JOIN public.checkout_quotes q ON q.id = a.quote_id
  WHERE a.order_id = v_order.id
  ORDER BY a.created_at
  LIMIT 1;

  FOR v_item IN
    SELECT oi.product_title, oi.product_sku, oi.unit_price_cents, oi.quantity,
           oi.line_subtotal_cents, oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id
    ORDER BY oi.created_at, oi.id
  LOOP
    v_rate := NULL;
    IF v_quote_lines IS NOT NULL THEN
      SELECT (elem->>'vat_rate')::numeric INTO v_rate
      FROM jsonb_array_elements(v_quote_lines) AS elem
      WHERE elem->>'sku' = v_item.product_sku
      LIMIT 1;
    END IF;
    IF v_rate IS NULL AND v_item.product_id IS NOT NULL THEN
      SELECT p.vat_rate INTO v_rate FROM public.products p WHERE p.id = v_item.product_id;
    END IF;
    v_rate := coalesce(v_rate, 21);
    IF v_regime = 'no_vat' THEN
      v_rate := 0;
    END IF;

    v_line_total := v_item.line_subtotal_cents;
    v_line_base := public.net_cents(v_line_total, v_rate);
    v_line_vat := v_line_total - v_line_base;
    v_base := v_base + v_line_base;
    v_vat := v_vat + v_line_vat;
    v_key := CASE
      WHEN v_rate = trunc(v_rate) THEN trunc(v_rate)::integer::text
      ELSE trim(trailing '.' FROM trim(trailing '0' FROM v_rate::text))
    END;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_item.product_title,
      'quantity', v_item.quantity,
      'unitNetCents', public.net_cents(v_item.unit_price_cents, v_rate),
      'vatRate', v_rate,
      'baseCents', v_line_base,
      'vatCents', v_line_vat,
      'totalCents', v_line_total
    ));
    v_breakdown := jsonb_set(
      v_breakdown,
      ARRAY[v_key],
      jsonb_build_object(
        'base', coalesce((v_breakdown -> v_key ->> 'base')::integer, 0) + v_line_base,
        'vat', coalesce((v_breakdown -> v_key ->> 'vat')::integer, 0) + v_line_vat
      ),
      true
    );
  END LOOP;

  v_rate := coalesce(v_quote_ship_rate, nullif(v_cfg->>'shippingVatRate', '')::numeric, 21);
  IF v_regime = 'no_vat' THEN
    v_rate := 0;
  END IF;
  v_line_total := coalesce(v_order.shipping_cents, 0);
  v_line_base := public.net_cents(v_line_total, v_rate);
  v_line_vat := v_line_total - v_line_base;
  v_base := v_base + v_line_base;
  v_vat := v_vat + v_line_vat;
  v_key := CASE
    WHEN v_rate = trunc(v_rate) THEN trunc(v_rate)::integer::text
    ELSE trim(trailing '.' FROM trim(trailing '0' FROM v_rate::text))
  END;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'description', CASE WHEN v_order.locale = 'en' THEN 'Shipping' ELSE 'Envío' END,
    'quantity', 1,
    'unitNetCents', v_line_base,
    'vatRate', v_rate,
    'baseCents', v_line_base,
    'vatCents', v_line_vat,
    'totalCents', v_line_total
  ));
  v_breakdown := jsonb_set(
    v_breakdown,
    ARRAY[v_key],
    jsonb_build_object(
      'base', coalesce((v_breakdown -> v_key ->> 'base')::integer, 0) + v_line_base,
      'vat', coalesce((v_breakdown -> v_key ->> 'vat')::integer, 0) + v_line_vat
    ),
    true
  );

  v_total := v_base + v_vat;
  v_issuer := jsonb_build_object(
    'issuerName', btrim(v_cfg->>'issuerName'),
    'issuerNif', btrim(v_cfg->>'issuerNif'),
    'issuerAddress', btrim(v_cfg->>'issuerAddress'),
    'issuerPostalCode', btrim(v_cfg->>'issuerPostalCode'),
    'issuerCity', btrim(v_cfg->>'issuerCity'),
    'issuerKind', coalesce(nullif(btrim(v_cfg->>'issuerKind'), ''), 'autonomo')
  );
  v_customer := CASE WHEN v_kind = 'full' THEN v_order.invoice_customer ELSE NULL END;
  v_note := public.vat_exemption_note(
    v_regime,
    coalesce(v_order.shipping_country, v_order.shipping_address->>'country'),
    coalesce(v_order.shipping_postal_code, v_order.shipping_address->>'postal_code'),
    v_order.locale::text
  );

  PERFORM pg_advisory_xact_lock(872023::bigint);
  v_prev := NULL;
  SELECT hash INTO v_prev
  FROM public.invoices
  ORDER BY record_generated_at DESC, id DESC
  LIMIT 1;

  v_at := clock_timestamp();
  v_local := timezone('Europe/Madrid', v_at);
  v_utc := timezone('UTC', v_at);
  v_off := v_local - v_utc;
  v_stamp := to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS')
          || CASE WHEN v_off >= interval '0' THEN '+' ELSE '-' END
          || to_char(abs(extract(epoch FROM v_off))::integer * interval '1 second', 'HH24:MI');
  v_issued_on := to_char(v_local, 'DD-MM-YYYY');
  v_tipo := CASE WHEN v_kind = 'full' THEN 'F1' ELSE 'F2' END;
  v_hash := public.verifactu_hash(
    v_issuer->>'issuerNif', v_full, v_issued_on, v_tipo,
    v_vat, v_total, coalesce(v_prev, ''), v_stamp
  );
  v_qr := 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
       || '?nif=' || (v_issuer->>'issuerNif')
       || '&numserie=' || v_full
       || '&fecha=' || v_issued_on
       || '&importe=' || public.verifactu_amount(v_total);

  INSERT INTO public.invoices (
    order_id, kind, series, number, full_number, issued_at, operation_date,
    issuer, customer, lines, breakdown, base_cents, vat_cents, total_cents,
    vat_regime, exemption_note, locale, prev_hash, hash, record_generated_at, qr_url
  ) VALUES (
    v_order.id, v_kind, v_prefix, v_number, v_full, v_at,
    (timezone('Europe/Madrid', coalesce(v_order.paid_at, v_at)))::date,
    v_issuer, v_customer, v_lines, v_breakdown, v_base, v_vat, v_total,
    v_regime, v_note, v_order.locale, v_prev, v_hash, v_at, v_qr
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_issue_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    BEGIN
      PERFORM public.issue_invoice(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'issue_invoice %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_issue_invoice ON public.orders;
CREATE TRIGGER orders_issue_invoice
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_issue_invoice();

CREATE OR REPLACE FUNCTION public.admin_issue_invoice(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_invoice(p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_issue_pending_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  FOR v_id IN
    SELECT o.id
    FROM public.orders o
    WHERE o.payment_status = 'paid'
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)
    ORDER BY o.paid_at, o.id
  LOOP
    PERFORM public.issue_invoice(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_invoice(
  p_reference text,
  p_access_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_hash text;
  v_invoice public.invoices%ROWTYPE;
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

  SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_guest_order(
  p_reference text,
  p_access_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
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
    'items', v_items,
    'invoice_number', (SELECT full_number FROM public.invoices WHERE order_id = v_order.id),
    'invoice_kind', (SELECT kind FROM public.invoices WHERE order_id = v_order.id),
    'invoice_issued_at', (SELECT issued_at FROM public.invoices WHERE order_id = v_order.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_issue_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_invoice(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_issue_pending_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_pending_invoices() TO authenticated;

REVOKE ALL ON FUNCTION public.guest_invoice(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_invoice(text, text) TO service_role;
