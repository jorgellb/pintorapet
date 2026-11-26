-- Coupons (Admin › Cupones): discount codes for the web shop only, priced by
-- the database. This part holds the tables and coupon_price, a pure pricing
-- function: given a code, the cart lines (catalogue unit prices with VAT) and
-- the context (destination, pickup, who is buying), it says whether the code
-- applies and, if so, the discounted unit price of every line.
--
-- All coupon amounts (fixed amount, cap, minimum purchase) are catalogue
-- prices with VAT, as the customer sees them in the shop.

CREATE TYPE public.coupon_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE public.coupon_kind AS ENUM ('percent', 'fixed', 'free_shipping', 'buy_x_get_y', 'nth_unit');

CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored upper-case; customers may type it in any case, with spaces around.
  code text NOT NULL,
  note text NOT NULL DEFAULT '',
  status public.coupon_status NOT NULL DEFAULT 'active',
  kind public.coupon_kind NOT NULL,
  -- percent and nth_unit: the percent off.
  percent numeric(5,2),
  -- fixed: the amount off.
  amount_cents integer,
  -- percent: the most it takes off; free_shipping: the most shipping it covers.
  cap_cents integer,
  -- buy_x_get_y: of every buy_qty + get_qty qualifying pieces, the get_qty cheapest are free.
  buy_qty integer,
  get_qty integer,
  -- nth_unit: of every nth qualifying pieces, the cheapest is percent off.
  nth integer,
  -- The qualifying pieces: all targets empty = the whole shop. Exclusions always win.
  category_ids uuid[] NOT NULL DEFAULT '{}',
  collection_ids uuid[] NOT NULL DEFAULT '{}',
  product_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_product_ids uuid[] NOT NULL DEFAULT '{}',
  -- Measured on the qualifying pieces, before the discount.
  min_subtotal_cents integer,
  min_units integer,
  -- Shipping zones allowed (empty = all), and shipped / picked up at a market.
  zone_ids uuid[] NOT NULL DEFAULT '{}',
  allow_shipping boolean NOT NULL DEFAULT true,
  allow_pickup boolean NOT NULL DEFAULT true,
  first_order_only boolean NOT NULL DEFAULT false,
  require_account boolean NOT NULL DEFAULT false,
  -- Personal coupons: only these emails (lower-case). With emails_require_account
  -- the customer must be signed in with one of them.
  emails text[] NOT NULL DEFAULT '{}',
  emails_require_account boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  -- ISO weekdays in Europe/Madrid (1 = Monday … 7 = Sunday); empty = every day.
  weekdays smallint[] NOT NULL DEFAULT '{}',
  max_uses integer,
  max_uses_per_customer integer,
  -- Shown on the shop's banner; one coupon at a time.
  announce boolean NOT NULL DEFAULT false,
  -- Bumped when a rule changes; part of the checkout quote's price fingerprint.
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_unique UNIQUE (code),
  CONSTRAINT coupons_code_format CHECK (code ~ '^[A-Z0-9_-]{3,30}$'),
  CONSTRAINT coupons_note_length CHECK (char_length(note) <= 500),
  CONSTRAINT coupons_kind_values CHECK (
    CASE kind
      WHEN 'percent' THEN percent IS NOT NULL
      WHEN 'fixed' THEN amount_cents IS NOT NULL
      WHEN 'buy_x_get_y' THEN buy_qty IS NOT NULL AND get_qty IS NOT NULL
      WHEN 'nth_unit' THEN nth IS NOT NULL AND percent IS NOT NULL
      ELSE true
    END
  ),
  CONSTRAINT coupons_value_ranges CHECK (
    (percent IS NULL OR percent BETWEEN 1 AND 100)
    AND (amount_cents IS NULL OR amount_cents > 0)
    AND (cap_cents IS NULL OR cap_cents > 0)
    AND (buy_qty IS NULL OR buy_qty >= 1)
    AND (get_qty IS NULL OR get_qty >= 1)
    AND (nth IS NULL OR nth >= 2)
    AND (min_subtotal_cents IS NULL OR min_subtotal_cents > 0)
    AND (min_units IS NULL OR min_units >= 1)
    AND (max_uses IS NULL OR max_uses >= 1)
    AND (max_uses_per_customer IS NULL OR max_uses_per_customer >= 1)
  ),
  CONSTRAINT coupons_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT coupons_weekdays CHECK (weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT coupons_emails_lower CHECK (emails::text = lower(emails::text)),
  CONSTRAINT coupons_version_positive CHECK (version > 0)
);

-- At most one announced coupon (the trigger below takes the previous one off).
CREATE UNIQUE INDEX IF NOT EXISTS coupons_one_announced ON public.coupons ((true)) WHERE announce;

-- On update: updated_at, and the version when a rule changes (not for the note
-- or the announcement, which do not change any price). Announcing a coupon
-- stops announcing the previous one.
CREATE OR REPLACE FUNCTION public.coupons_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF (to_jsonb(NEW) - ARRAY['note', 'announce', 'updated_at', 'version'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['note', 'announce', 'updated_at', 'version']) THEN
      NEW.version := OLD.version + 1;
    ELSE
      NEW.version := OLD.version;
    END IF;
  END IF;
  IF NEW.announce AND (TG_OP = 'INSERT' OR NOT OLD.announce) THEN
    UPDATE public.coupons SET announce = false WHERE announce AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coupons_before_write ON public.coupons;
CREATE TRIGGER coupons_before_write
  BEFORE INSERT OR UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.coupons_before_write();

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupons_admin_all ON public.coupons;
CREATE POLICY coupons_admin_all ON public.coupons
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.coupons FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;

-- One use of a coupon per order. A use counts unless its order expired or was
-- cancelled (a refunded order still used the coupon).
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  order_id uuid PRIMARY KEY REFERENCES public.orders (id) ON DELETE CASCADE,
  coupon_id uuid NOT NULL REFERENCES public.coupons (id) ON DELETE RESTRICT,
  -- The email the use was claimed with; payer_email: the one the payment
  -- brought, when another. The use counts for both.
  email text,
  payer_email text,
  customer_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  discount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupon_redemptions_discount_nonneg CHECK (discount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON public.coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_customer_idx ON public.coupon_redemptions (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupon_redemptions_admin_all ON public.coupon_redemptions;
CREATE POLICY coupon_redemptions_admin_all ON public.coupon_redemptions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.coupon_redemptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupon_redemptions TO authenticated;

-- A snapshot of the coupon on the order, so editing or deleting the coupon
-- never changes past orders. coupon_over_limit: paid after its use had lapsed
-- with the limit already full (accepted, flagged for Admin).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_over_limit boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_coupon_discount_nonneg;
ALTER TABLE public.orders ADD CONSTRAINT orders_coupon_discount_nonneg CHECK (coupon_discount_cents >= 0);
CREATE INDEX IF NOT EXISTS orders_coupon_idx ON public.orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- The coupon a quote was priced with, or why the code typed was refused.
ALTER TABLE public.checkout_quotes
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_error text,
  ADD COLUMN IF NOT EXISTS coupon_missing_cents integer;
ALTER TABLE public.checkout_quotes DROP CONSTRAINT IF EXISTS checkout_quotes_coupon_discount_nonneg;
ALTER TABLE public.checkout_quotes ADD CONSTRAINT checkout_quotes_coupon_discount_nonneg CHECK (coupon_discount_cents >= 0);

-- Uses of a coupon that still count (order not expired or cancelled), leaving
-- out p_except_order; by_customer: those with that email (claimed or paid
-- with) or that account.
CREATE OR REPLACE FUNCTION public.coupon_uses(p_coupon_id uuid, p_email text, p_customer_id uuid, p_except_order uuid)
RETURNS TABLE (total integer, by_customer integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::integer,
         (count(*) FILTER (
           WHERE (nullif(btrim(p_email), '') IS NOT NULL
                  AND (lower(r.email) = lower(btrim(p_email)) OR lower(r.payer_email) = lower(btrim(p_email))))
              OR (p_customer_id IS NOT NULL AND r.customer_id = p_customer_id)
         ))::integer
  FROM public.coupon_redemptions r
  JOIN public.orders o ON o.id = r.order_id
  WHERE r.coupon_id = p_coupon_id
    AND o.payment_status NOT IN ('expired', 'cancelled')
    AND (p_except_order IS NULL OR r.order_id <> p_except_order);
$$;

REVOKE ALL ON FUNCTION public.coupon_uses(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_uses(uuid, text, uuid, uuid) TO service_role;

-- p_lines: [{ product_id, quantity, gross_cents }] (catalogue unit price with VAT)
-- p_ctx:   { zone_id, pickup, shipping_cents (charged), email, customer_id, order_id, at }, any may be null
-- Ok:      { ok: true, coupon_id, code, version, kind, discount_cents, shipping_free, shipping_cap_cents,
--            lines: [{ product_id, unit_gross_cents }] } (every input line, in input order)
-- Refused: { ok: false, code, reason, missing_cents?, missing_units? }
CREATE OR REPLACE FUNCTION public.coupon_price(p_code text, p_lines jsonb, p_ctx jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_ctx jsonb := coalesce(p_ctx, '{}'::jsonb);
  v_at timestamptz := coalesce(nullif(v_ctx->>'at', '')::timestamptz, now());
  v_zone uuid := nullif(v_ctx->>'zone_id', '')::uuid;
  v_pickup boolean := coalesce((v_ctx->>'pickup')::boolean, false);
  v_shipping integer := greatest(coalesce((v_ctx->>'shipping_cents')::integer, 0), 0);
  v_email text := lower(nullif(btrim(coalesce(v_ctx->>'email', '')), ''));
  v_customer uuid := nullif(v_ctx->>'customer_id', '')::uuid;
  v_order uuid := nullif(v_ctx->>'order_id', '')::uuid;
  v_account_email text;
  v_c public.coupons%ROWTYPE;
  v_pid uuid[];
  v_qty integer[];
  v_gross integer[];
  v_q boolean[];
  v_n integer;
  v_units integer := 0;        -- qualifying pieces
  v_q_gross integer := 0;      -- qualifying pieces, gross
  v_all_gross integer := 0;    -- every piece, gross
  v_slack integer := 0;        -- most the per-unit rounding can add to the discount
  v_k integer;
  v_d integer := 0;
  v_share integer[];
  v_given integer := 0;
  v_largest integer;
  v_cut integer;
  v_discount integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_uses record;
  i integer;
BEGIN
  SELECT * INTO v_c FROM public.coupons WHERE code = v_code AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_NOT_FOUND');
  END IF;

  -- When.
  IF v_c.starts_at IS NOT NULL AND v_at < v_c.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_NOT_STARTED');
  END IF;
  IF v_c.ends_at IS NOT NULL AND v_at >= v_c.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_EXPIRED');
  END IF;
  IF cardinality(v_c.weekdays) > 0
     AND NOT (extract(isodow FROM v_at AT TIME ZONE 'Europe/Madrid')::smallint = ANY (v_c.weekdays)) THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_WRONG_DAY');
  END IF;

  -- Where it goes.
  IF v_pickup THEN
    IF NOT v_c.allow_pickup THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_PICKUP');
    END IF;
  ELSE
    IF NOT v_c.allow_shipping THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_SHIPPING');
    END IF;
    -- Judged once the destination is known: before an address there is no
    -- zone yet. An order always has one (a quote without a destination
    -- cannot be reserved: SHIPPING_REQUIRED), so the claim judges it.
    IF cardinality(v_c.zone_ids) > 0 AND v_zone IS NOT NULL AND NOT (v_zone = ANY (v_c.zone_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_ZONE');
    END IF;
  END IF;

  -- The lines, and which of them qualify.
  SELECT array_agg(l.pid ORDER BY l.ord), array_agg(l.qty ORDER BY l.ord), array_agg(l.gross ORDER BY l.ord),
         array_agg(coalesce(
           p.id IS NOT NULL AND l.qty > 0 AND l.gross >= 0
           AND NOT (p.id = ANY (v_c.excluded_product_ids))
           AND ((cardinality(v_c.product_ids) = 0 AND cardinality(v_c.category_ids) = 0 AND cardinality(v_c.collection_ids) = 0)
                OR p.id = ANY (v_c.product_ids)
                OR p.category_id = ANY (v_c.category_ids)
                OR p.collection_id = ANY (v_c.collection_ids)),
           false) ORDER BY l.ord)
  INTO v_pid, v_qty, v_gross, v_q
  FROM (
    SELECT t.ord, nullif(t.e->>'product_id', '')::uuid AS pid,
           coalesce((t.e->>'quantity')::integer, 0) AS qty, coalesce((t.e->>'gross_cents')::integer, 0) AS gross
    FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
  ) l
  LEFT JOIN public.products p ON p.id = l.pid;
  v_n := coalesce(cardinality(v_pid), 0);

  FOR i IN 1..v_n LOOP
    IF v_qty[i] > 0 THEN
      v_all_gross := v_all_gross + v_gross[i] * v_qty[i];
    END IF;
    IF v_q[i] THEN
      v_units := v_units + v_qty[i];
      v_q_gross := v_q_gross + v_gross[i] * v_qty[i];
      v_slack := v_slack + v_qty[i] - 1;
    END IF;
  END LOOP;

  IF v_units = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_NO_ITEMS');
  END IF;
  IF v_c.min_subtotal_cents IS NOT NULL AND v_q_gross < v_c.min_subtotal_cents THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_MIN_SUBTOTAL',
                              'missing_cents', v_c.min_subtotal_cents - v_q_gross);
  END IF;
  IF v_c.min_units IS NOT NULL AND v_units < v_c.min_units THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_MIN_UNITS',
                              'missing_units', v_c.min_units - v_units);
  END IF;

  -- Who. A signed-in customer with no email typed yet is judged by the account's email.
  IF v_customer IS NOT NULL THEN
    SELECT lower(u.email) INTO v_account_email FROM auth.users u WHERE u.id = v_customer;
  END IF;
  v_email := coalesce(v_email, v_account_email);
  -- Before the email is known (first quote) only require_account can be judged.
  IF v_email IS NOT NULL OR v_customer IS NOT NULL THEN
    IF v_c.first_order_only AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.paid_at IS NOT NULL
        AND (v_order IS NULL OR o.id <> v_order)
        AND ((v_email IS NOT NULL AND lower(o.customer_email) = v_email)
             OR (v_customer IS NOT NULL AND o.customer_id = v_customer))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_FIRST_ORDER');
    END IF;
  END IF;
  IF v_c.require_account AND v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_ACCOUNT');
  END IF;
  IF (v_email IS NOT NULL OR v_customer IS NOT NULL) AND cardinality(v_c.emails) > 0 THEN
    IF v_email IS NULL OR NOT (v_email = ANY (v_c.emails))
       OR (v_c.emails_require_account AND v_account_email IS DISTINCT FROM v_email) THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_EMAIL');
    END IF;
  END IF;

  -- Uses.
  IF v_c.max_uses IS NOT NULL OR v_c.max_uses_per_customer IS NOT NULL THEN
    SELECT * INTO v_uses FROM public.coupon_uses(v_c.id, v_email, v_customer, v_order);
    IF v_c.max_uses IS NOT NULL AND v_uses.total >= v_c.max_uses THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_SOLD_OUT');
    END IF;
    IF v_c.max_uses_per_customer IS NOT NULL AND v_uses.by_customer >= v_c.max_uses_per_customer THEN
      RETURN jsonb_build_object('ok', false, 'code', v_code, 'reason', 'COUPON_USED');
    END IF;
  END IF;

  -- D: gross cents off the qualifying pieces.
  IF v_c.kind = 'percent' THEN
    FOR i IN 1..v_n LOOP
      IF v_q[i] THEN
        v_d := v_d + round(v_gross[i] * v_c.percent / 100)::integer * v_qty[i];
      END IF;
    END LOOP;
    IF v_c.cap_cents IS NOT NULL THEN
      v_d := least(v_d, v_c.cap_cents);
    END IF;
  ELSIF v_c.kind = 'fixed' THEN
    v_d := v_c.amount_cents;
  ELSIF v_c.kind IN ('buy_x_get_y', 'nth_unit') THEN
    -- The cheapest qualifying pieces of every group.
    v_k := CASE WHEN v_c.kind = 'buy_x_get_y' THEN v_c.get_qty * (v_units / (v_c.buy_qty + v_c.get_qty))
                ELSE v_units / v_c.nth END;
    SELECT coalesce(sum(CASE WHEN v_c.kind = 'buy_x_get_y' THEN s.price
                             ELSE round(s.price * v_c.percent / 100)::integer END), 0)::integer
    INTO v_d
    FROM (
      SELECT u.price
      FROM unnest(v_gross, v_qty, v_q) AS u(price, qty, q)
      CROSS JOIN LATERAL generate_series(1, u.qty)
      WHERE u.q
      ORDER BY u.price
      LIMIT v_k
    ) s;
  END IF;
  -- Never more than the qualifying pieces, and the order keeps at least 50 cents
  -- (Stripe's minimum) even after the per-unit rounding below.
  v_d := greatest(0, least(v_d, v_q_gross, v_all_gross + v_shipping - 50 - v_slack));

  -- Spread D over the qualifying lines in proportion to their gross, the
  -- leftover cents to the largest line.
  v_share := array_fill(0, ARRAY[greatest(v_n, 1)]);
  IF v_d > 0 THEN
    FOR i IN 1..v_n LOOP
      IF v_q[i] THEN
        v_share[i] := floor(v_d::numeric * v_gross[i] * v_qty[i] / v_q_gross)::integer;
        v_given := v_given + v_share[i];
        IF v_largest IS NULL OR v_gross[i] * v_qty[i] > v_gross[v_largest] * v_qty[v_largest] THEN
          v_largest := i;
        END IF;
      END IF;
    END LOOP;
    v_share[v_largest] := v_share[v_largest] + v_d - v_given;
  END IF;

  -- Every unit keeps an integer price: the per-unit cut rounds up, in the
  -- customer's favour, and leaves at least 1 cent (an order line is never 0 €).
  FOR i IN 1..v_n LOOP
    v_cut := CASE WHEN v_share[i] > 0 THEN least(ceil(v_share[i]::numeric / v_qty[i])::integer, greatest(v_gross[i] - 1, 0)) ELSE 0 END;
    v_discount := v_discount + v_cut * greatest(v_qty[i], 0);
    v_out := v_out || jsonb_build_array(jsonb_build_object('product_id', v_pid[i], 'unit_gross_cents', v_gross[i] - v_cut));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'coupon_id', v_c.id,
    'code', v_c.code,
    'version', v_c.version,
    'kind', v_c.kind,
    'discount_cents', v_discount,
    'shipping_free', v_c.kind = 'free_shipping',
    'shipping_cap_cents', CASE WHEN v_c.kind = 'free_shipping' THEN v_c.cap_cents END,
    'lines', v_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.coupon_price(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_price(text, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Checkout quotes priced with the coupon.
--
-- create_checkout_quote takes the code typed (and who is buying, from the
-- server). The catalogue lines go through coupon_price; each line is charged
-- its discounted unit (net of VAT for no_vat), keeps its catalogue price for
-- the price check, and says its price before the coupon (list_unit_cents).
-- Free shipping is judged on the subtotal after the discount. A code that is
-- refused still gives a quote, without discount and with the reason. The
-- coupon and its version enter the price fingerprint, so pausing or editing
-- it makes an open quote stale at reserve_checkout, as a price change does.
-- ---------------------------------------------------------------------------

ALTER TABLE public.checkout_quotes ADD COLUMN IF NOT EXISTS coupon_missing_units integer;

-- p_discount_cents: catalogue cents off the pieces (with VAT), taken off the
-- subtotal before the free-shipping threshold is compared. vat_discount_cents
-- stays measured on catalogue prices; create_checkout_quote works out its own.
DROP FUNCTION IF EXISTS public.shipping_quote(public.cart_line_input[], text, text);

CREATE OR REPLACE FUNCTION public.shipping_quote(
  p_lines public.cart_line_input[],
  p_country text,
  p_postal_code text,
  p_discount_cents integer DEFAULT 0
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
  v_ship_vat integer := 0;
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

  -- Free shipping is judged after the coupon's discount.
  IF v_zone.free_over_cents IS NOT NULL
     AND v_subtotal - greatest(coalesce(p_discount_cents, 0), 0) >= v_zone.free_over_cents THEN
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
    v_ship_vat := v_price - public.net_cents(v_price, v_ship_rate);
    v_discount := (v_subtotal - v_subtotal_net) + v_ship_vat;
    v_price := v_price - v_ship_vat;
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
    'vat_discount_cents', v_discount,
    'shipping_vat_taken_cents', v_ship_vat
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shipping_quote(public.cart_line_input[], text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipping_quote(public.cart_line_input[], text, text, integer) TO service_role;

-- p_coupon_ctx: { email, customer_id } from the server (who is buying), and
-- pickup (set by create_pickup_quote). Nothing else is read from it: the zone,
-- the shipping and the time are the quote's own.
DROP FUNCTION IF EXISTS public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_checkout_quote(
  p_cart_owner_hash text,
  p_locale public.locale_code,
  p_lines public.cart_line_input[],
  p_country text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_invoice_customer jsonb DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_coupon_ctx jsonb DEFAULT NULL
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
  v_code text := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
  v_cpn jsonb;
  v_cpn_ok boolean := false;
  v_gross integer := 0;        -- the pieces at their price with VAT (after the coupon)
  v_list integer;              -- the pieces as charged before the coupon
  v_ship_vat integer := 0;     -- VAT taken off the shipping (no_vat)
  v_ship_gross integer;
  v_ship_saved integer := 0;   -- shipping covered by a free-shipping coupon
  v_n integer;
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
    v_gross := v_gross + (v_catalog * v_qty);
    v_fingerprint := v_fingerprint || v_product.id::text || ':'
      || v_product.price_version::text || ':'
      || v_catalog::text || ':' || v_rate::text || ';';
    v_lines_json := v_lines_json || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'quantity', v_qty,
      'catalog_price_cents', v_catalog,
      'list_unit_cents', v_unit,
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

  -- Shipping before the coupon: the zone the coupon is judged on, and the
  -- shipping its 50-cent floor counts on (the discount can only raise it).
  IF p_country IS NOT NULL THEN
    v_ship := public.shipping_quote(v_merged, p_country, p_postal_code);
    IF NOT (v_ship->>'available')::boolean THEN
      RAISE EXCEPTION 'SHIPPING_%', v_ship->>'reason' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_list := v_subtotal;
  IF v_code IS NOT NULL THEN
    v_cpn := public.coupon_price(
      v_code,
      (SELECT jsonb_agg(jsonb_build_object(
                'product_id', t.e->'product_id', 'quantity', t.e->'quantity', 'gross_cents', t.e->'catalog_price_cents')
              ORDER BY t.ord)
       FROM jsonb_array_elements(v_lines_json) WITH ORDINALITY AS t(e, ord)),
      jsonb_build_object(
        'email', p_coupon_ctx->>'email',
        'customer_id', p_coupon_ctx->>'customer_id',
        -- Only a quote with no destination can be a pickup.
        'pickup', p_country IS NULL AND coalesce((p_coupon_ctx->>'pickup')::boolean, false),
        'zone_id', v_ship->>'zone_id',
        'shipping_cents', coalesce((v_ship->>'shipping_cents')::integer, 0)
      )
    );
    v_cpn_ok := coalesce((v_cpn->>'ok')::boolean, false);
  END IF;

  IF v_cpn_ok THEN
    -- coupon_price returns every line, in the order given; matched by position
    -- and product, and a line lost on the way is an error, never a free line.
    IF jsonb_array_length(v_cpn->'lines') <> jsonb_array_length(v_lines_json) THEN
      RAISE EXCEPTION 'COUPON_LINES_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    v_n := jsonb_array_length(v_lines_json);
    SELECT jsonb_agg(x.e || jsonb_build_object('unit_price_cents', x.unit, 'line_subtotal_cents', x.unit * x.qty) ORDER BY x.ord),
           sum(x.unit * x.qty)::integer,
           sum(x.gross * x.qty)::integer
    INTO v_lines_json, v_subtotal, v_gross
    FROM (
      SELECT t.ord, t.e, (t.e->>'quantity')::integer AS qty, g.gross,
             -- A 1-cent unit stays 1 cent net: an order line is never 0 €.
             CASE WHEN v_regime = 'no_vat' THEN greatest(1, public.net_cents(g.gross, (t.e->>'vat_rate')::numeric)) ELSE g.gross END AS unit
      FROM jsonb_array_elements(v_lines_json) WITH ORDINALITY AS t(e, ord)
      JOIN jsonb_array_elements(v_cpn->'lines') WITH ORDINALITY AS c(l, ord)
        ON c.ord = t.ord AND c.l->>'product_id' = t.e->>'product_id'
      CROSS JOIN LATERAL (SELECT (c.l->>'unit_gross_cents')::integer AS gross) g
    ) x;
    IF coalesce(jsonb_array_length(v_lines_json), 0) <> v_n THEN
      RAISE EXCEPTION 'COUPON_LINES_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    IF p_country IS NOT NULL AND (v_cpn->>'discount_cents')::integer > 0 THEN
      v_ship := public.shipping_quote(v_merged, p_country, p_postal_code, (v_cpn->>'discount_cents')::integer);
    END IF;
  END IF;

  IF v_ship IS NOT NULL THEN
    v_shipping := (v_ship->>'shipping_cents')::integer;
    v_ship_vat := coalesce((v_ship->>'shipping_vat_taken_cents')::integer, 0);
  END IF;

  -- A free-shipping coupon covers the shipping with VAT, up to its cap.
  IF v_cpn_ok AND (v_cpn->>'shipping_free')::boolean AND v_shipping > 0 THEN
    v_ship_gross := v_shipping + v_ship_vat;
    v_ship_gross := v_ship_gross - least(v_ship_gross, coalesce((v_cpn->>'shipping_cap_cents')::integer, v_ship_gross));
    v_ship_saved := v_shipping;
    IF v_regime = 'no_vat' THEN
      v_shipping := public.net_cents(v_ship_gross, v_ship_rate);
      v_ship_vat := v_ship_gross - v_shipping;
    ELSE
      v_shipping := v_ship_gross;
    END IF;
    v_ship_saved := v_ship_saved - v_shipping;
  END IF;

  IF v_regime = 'no_vat' THEN
    v_discount := (v_gross - v_subtotal) + v_ship_vat;
  END IF;

  v_fingerprint := v_fingerprint || 'cfg:' || v_settings.config_version::text;
  IF v_cpn_ok THEN
    v_fingerprint := v_fingerprint || ';cpn:' || (v_cpn->>'coupon_id') || ':' || (v_cpn->>'version');
  END IF;
  v_total := v_subtotal + v_shipping + v_tax;

  INSERT INTO public.checkout_quotes (
    cart_owner_hash, locale, lines, price_fingerprint, config_version,
    subtotal_cents, shipping_cents, tax_cents, total_cents, currency,
    shipping_zone, shipping_country, shipping_postal_code, shipping_zone_name,
    shipping_weight_grams, expires_at,
    vat_regime, vat_discount_cents, shipping_vat_rate, invoice_customer,
    coupon_id, coupon_code, coupon_discount_cents, coupon_error, coupon_missing_cents, coupon_missing_units
  ) VALUES (
    p_cart_owner_hash, p_locale, v_lines_json,
    encode(digest(v_fingerprint, 'sha256'), 'hex'), v_settings.config_version,
    v_subtotal, v_shipping, v_tax, v_total, 'EUR',
    v_ship->>'zone_id', v_ship->>'country', v_ship->>'postal_code',
    CASE WHEN p_locale = 'es' THEN v_ship->>'zone_name_es' ELSE v_ship->>'zone_name_en' END,
    (v_ship->>'weight_grams')::integer,
    now() + make_interval(secs => v_settings.quote_ttl_seconds),
    v_regime, v_discount, coalesce(v_ship_rate, 21), p_invoice_customer,
    CASE WHEN v_cpn_ok THEN (v_cpn->>'coupon_id')::uuid END,
    v_cpn->>'code',
    CASE WHEN v_cpn_ok THEN (v_list - v_subtotal) + v_ship_saved ELSE 0 END,
    CASE WHEN NOT v_cpn_ok THEN v_cpn->>'reason' END,
    (v_cpn->>'missing_cents')::integer,
    (v_cpn->>'missing_units')::integer
  )
  RETURNING * INTO v_quote;

  RETURN v_quote;
END;
$$;

REVOKE ALL ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text, text, jsonb, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.create_pickup_quote(text, public.locale_code, public.cart_line_input[], uuid, jsonb);

CREATE OR REPLACE FUNCTION public.create_pickup_quote(
  p_cart_owner_hash text,
  p_locale public.locale_code,
  p_lines public.cart_line_input[],
  p_market_id uuid,
  p_invoice_customer jsonb DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_coupon_ctx jsonb DEFAULT NULL
)
RETURNS public.checkout_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_market public.markets%ROWTYPE;
  v_quote public.checkout_quotes%ROWTYPE;
BEGIN
  SELECT * INTO v_market FROM public.markets
  WHERE id = p_market_id AND published AND pickup
    AND ends_on >= (now() AT TIME ZONE 'Europe/Madrid')::date;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PICKUP_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  v_quote := public.create_checkout_quote(p_cart_owner_hash, p_locale, p_lines, NULL, NULL, p_invoice_customer,
                                          p_coupon_code, coalesce(p_coupon_ctx, '{}'::jsonb) || '{"pickup": true}'::jsonb);

  UPDATE public.checkout_quotes
  SET shipping_country = 'ES',
      shipping_postal_code = NULL,
      shipping_zone = NULL,
      shipping_zone_name = v_market.name,
      shipping_cents = 0,
      total_cents = subtotal_cents + tax_cents,
      vat_regime = 'es_vat',
      pickup_market_id = v_market.id
  WHERE id = v_quote.id
  RETURNING * INTO v_quote;
  RETURN v_quote;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pickup_quote(text, public.locale_code, public.cart_line_input[], uuid, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pickup_quote(text, public.locale_code, public.cart_line_input[], uuid, jsonb, text, jsonb) TO service_role;

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
      invoice_customer = q.invoice_customer,
      market_id = coalesce(q.pickup_market_id, o.market_id),
      pickup = q.pickup_market_id IS NOT NULL,
      coupon_id = q.coupon_id,
      coupon_code = CASE WHEN q.coupon_id IS NOT NULL THEN q.coupon_code END,
      coupon_discount_cents = q.coupon_discount_cents
  FROM public.checkout_quotes q
  WHERE q.id = NEW.quote_id AND o.id = NEW.order_id;
  RETURN NULL;
END;
$$;

-- reserve_checkout (latest body in 20261126000008) rebuilds the price
-- fingerprint; it now adds the coupon (id and current version) when the quote
-- has one, so a coupon paused, archived or edited since the quote is a price
-- change. Who may use it and its uses are checked when the use is claimed.
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
  v_request public.commission_requests%ROWTYPE;
  v_coupon_version integer;
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

  -- A commission's portrait is no catalogue product: no stock, no catalogue price.
  IF v_quote.commission_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.commission_requests
    WHERE id = v_quote.commission_request_id AND status = 'quoted' AND paid_order_id IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMMISSION_NOT_PAYABLE' USING ERRCODE = 'P0001';
    END IF;
    -- Quoted again since (another price, VAT or link): this quote is gone.
    IF v_quote.price_fingerprint <> public.commission_quote_fingerprint(v_request) THEN
      RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT coalesce(array_agg((elem->>'product_id')::uuid ORDER BY (elem->>'product_id')::uuid), ARRAY[]::uuid[])
  INTO v_sorted_ids
  FROM jsonb_array_elements(v_quote.lines) AS elem
  WHERE elem->>'product_id' IS NOT NULL;

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
  IF v_quote.coupon_id IS NOT NULL THEN
    SELECT version INTO v_coupon_version FROM public.coupons WHERE id = v_quote.coupon_id AND status = 'active';
    -- Paused, archived or deleted: no version, so the fingerprint cannot match.
    v_fingerprint := v_fingerprint || ';cpn:' || v_quote.coupon_id::text || ':' || coalesce(v_coupon_version::text, 'gone');
  END IF;
  IF v_quote.commission_request_id IS NULL AND encode(digest(v_fingerprint, 'sha256'), 'hex') <> v_quote.price_fingerprint THEN
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
    v_product_id := nullif(v_line->>'product_id', '')::uuid;
    v_qty := (v_line->>'quantity')::integer;
    v_cover := NULL;

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

    IF v_product_id IS NOT NULL THEN
      UPDATE public.inventory
      SET
        stock_reserved = stock_reserved + v_qty,
        version = version + 1
      WHERE product_id = v_product_id;
    END IF;
  END LOOP;

  IF v_quote.commission_request_id IS NOT NULL THEN
    UPDATE public.orders
    SET commission_request_id = v_quote.commission_request_id, commission_fingerprint = v_quote.price_fingerprint
    WHERE id = v_order_id;
  END IF;

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
  FROM jsonb_array_elements(v_quote.lines) AS elem
  WHERE elem->>'product_id' IS NOT NULL;

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

-- ---------------------------------------------------------------------------
-- Claiming a use, and paid orders over the limit.
--
-- claim_order_coupon runs when the checkout opens, once the order knows who is
-- buying (email, account). With the coupon row locked, so two tabs cannot both
-- take the last use, it prices the order's quote again as create_checkout_quote
-- did, now with the email, and records the use. The fingerprint already made
-- reserve_checkout refuse a coupon edited since the quote; this catches what
-- depends on who, when and how many. A refusal raises the reason; the caller
-- cancels the order.
--
-- orders_coupon_paid: when an order with a coupon is paid, the use is recorded
-- if it is missing. An order that did not hold its use all along (it lapsed,
-- or was never claimed) and finds the limit full with the others' uses, or one
-- paid with an email the coupon is not for (personal or first-order coupons),
-- is accepted and flagged with coupon_over_limit for Admin.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_order_coupon(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.checkout_quotes%ROWTYPE;
  v_c public.coupons%ROWTYPE;
  v_code text;
  v_cart public.cart_line_input[];
  v_ship jsonb;
  v_shipping integer := 0;
  v_cpn jsonb;
  v_n integer;
  v_same integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.coupon_id IS NULL THEN
    -- Priced with a coupon that has since been deleted.
    IF v_order.coupon_code IS NOT NULL THEN
      RAISE EXCEPTION 'COUPON_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('claimed', false);
  END IF;
  -- A coupon that saved nothing (free shipping on an order that ships free) takes no use.
  IF v_order.coupon_discount_cents = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'NO_SAVING');
  END IF;

  -- The lock comes first: every claim of this coupon waits here, and counts
  -- the uses only once the one before it has committed.
  SELECT * INTO v_c FROM public.coupons WHERE id = v_order.coupon_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  v_code := v_c.code;

  -- A replayed attempt holds its use already.
  IF EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE order_id = v_order.id) THEN
    RETURN jsonb_build_object('claimed', true);
  END IF;

  -- coupon_price waits for the email before judging who; at the claim it must
  -- be known, or a coupon about who could be used by anyone.
  IF nullif(btrim(v_order.customer_email), '') IS NULL AND v_order.customer_id IS NULL
     AND (cardinality(v_c.emails) > 0 OR v_c.first_order_only OR v_c.require_account
          OR v_c.max_uses_per_customer IS NOT NULL) THEN
    RAISE EXCEPTION 'COUPON_EMAIL' USING ERRCODE = 'P0001';
  END IF;

  SELECT q.* INTO v_quote
  FROM public.checkout_attempts a
  JOIN public.checkout_quotes q ON q.id = a.quote_id
  WHERE a.order_id = v_order.id
  ORDER BY a.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUOTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- The shipping before the coupon, as create_checkout_quote passed it.
  IF v_quote.pickup_market_id IS NULL AND v_quote.shipping_country IS NOT NULL THEN
    SELECT array_agg(ROW((e->>'product_id')::uuid, (e->>'quantity')::integer)::public.cart_line_input)
    INTO v_cart
    FROM jsonb_array_elements(v_quote.lines) AS e;
    v_ship := public.shipping_quote(v_cart, v_quote.shipping_country, v_quote.shipping_postal_code);
    v_shipping := coalesce((v_ship->>'shipping_cents')::integer, 0);
  END IF;

  v_cpn := public.coupon_price(
    v_code,
    (SELECT jsonb_agg(jsonb_build_object(
              'product_id', t.e->'product_id', 'quantity', t.e->'quantity', 'gross_cents', t.e->'catalog_price_cents')
            ORDER BY t.ord)
     FROM jsonb_array_elements(v_quote.lines) WITH ORDINALITY AS t(e, ord)),
    jsonb_build_object(
      'email', v_order.customer_email,
      'customer_id', v_order.customer_id,
      'pickup', v_quote.pickup_market_id IS NOT NULL,
      'zone_id', v_quote.shipping_zone,
      'shipping_cents', v_shipping,
      'order_id', v_order.id
    )
  );
  IF NOT coalesce((v_cpn->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '%', coalesce(v_cpn->>'reason', 'COUPON_NOT_FOUND') USING ERRCODE = 'P0001';
  END IF;

  -- Compared in the quote's own terms: every line charged the same unit
  -- (net of VAT for no_vat), so an unchanged coupon is never a change.
  v_n := jsonb_array_length(v_quote.lines);
  SELECT count(*) INTO v_same
  FROM jsonb_array_elements(v_quote.lines) WITH ORDINALITY AS t(e, ord)
  JOIN jsonb_array_elements(v_cpn->'lines') WITH ORDINALITY AS c(l, ord)
    ON c.ord = t.ord AND c.l->>'product_id' = t.e->>'product_id'
  WHERE (t.e->>'unit_price_cents')::integer =
        CASE WHEN v_quote.vat_regime = 'no_vat'
             THEN greatest(1, public.net_cents((c.l->>'unit_gross_cents')::integer, (t.e->>'vat_rate')::numeric))
             ELSE (c.l->>'unit_gross_cents')::integer END;
  IF (v_cpn->>'coupon_id')::uuid <> v_order.coupon_id
     OR jsonb_array_length(v_cpn->'lines') <> v_n OR v_same <> v_n THEN
    RAISE EXCEPTION 'COUPON_CHANGED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.coupon_redemptions (order_id, coupon_id, email, customer_id, discount_cents)
  VALUES (v_order.id, v_order.coupon_id, lower(nullif(btrim(v_order.customer_email), '')), v_order.customer_id,
          v_order.coupon_discount_cents)
  ON CONFLICT (order_id) DO NOTHING;

  RETURN jsonb_build_object('claimed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_order_coupon(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_coupon(uuid) TO service_role;

-- release_owner_coupon_orders runs before the claim. A customer who goes back
-- from the payment page and presses «Pagar» again gets a new order, while the
-- one they left still holds its use (a Stripe session lasts until it expires).
-- So the same cart owner's other unpaid orders holding this coupon's use end
-- now as their session would have: expired (their stock goes back, their use
-- stops counting). Not cancelled: a cancelled order cannot take a payment, and
-- the old Stripe page may still be paid before the caller expires it. Paid
-- anyway, it is a late payment: review, flagged if the limit is full by then.
-- Returns them, with their Stripe session, which the caller expires.
CREATE OR REPLACE FUNCTION public.release_owner_coupon_orders(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_coupon uuid;
  v_owner text;
  v_old record;
  v_attempt uuid;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT coupon_id INTO v_coupon FROM public.orders WHERE id = p_order_id;
  SELECT a.cart_owner_hash INTO v_owner
  FROM public.checkout_attempts a
  WHERE a.order_id = p_order_id
  ORDER BY a.created_at DESC
  LIMIT 1;
  IF v_coupon IS NULL OR v_owner IS NULL THEN
    RETURN v_out;
  END IF;

  FOR v_old IN
    SELECT o.id,
           coalesce(o.stripe_session_id,
                    (SELECT a.stripe_session_id FROM public.checkout_attempts a
                     WHERE a.order_id = o.id AND a.stripe_session_id IS NOT NULL
                     ORDER BY a.created_at DESC LIMIT 1)) AS stripe_session_id
    FROM public.coupon_redemptions r
    JOIN public.orders o ON o.id = r.order_id
    WHERE r.coupon_id = v_coupon
      AND o.id <> p_order_id
      AND o.payment_status IN ('pending_session', 'checkout_open')
      AND o.paid_at IS NULL
      AND EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.order_id = o.id AND a.cart_owner_hash = v_owner)
    ORDER BY o.id
  LOOP
    BEGIN
      FOR v_attempt IN
        SELECT a.id FROM public.checkout_attempts a
        WHERE a.order_id = v_old.id AND a.status NOT IN ('paid', 'cancelled', 'expired')
      LOOP
        PERFORM public.release_reservations(v_attempt, 'superseded');
      END LOOP;
      -- Paid meanwhile, it keeps its status and its use.
      IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_old.id AND payment_status = 'expired') THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('order_id', v_old.id, 'stripe_session_id', v_old.stripe_session_id));
      END IF;
    EXCEPTION WHEN raise_exception THEN
      NULL;
    END;
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.release_owner_coupon_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_owner_coupon_orders(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.orders_coupon_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c public.coupons%ROWTYPE;
  v_email text := lower(nullif(btrim(NEW.customer_email), ''));
  v_account_email text;
  v_who text;
  v_wrong_who boolean := false;
  v_over boolean := false;
  v_held boolean;
  v_claimed boolean;
  v_claim_email text;
  v_uses record;
BEGIN
  -- Locked, so two payments at once count each other.
  SELECT * INTO v_c FROM public.coupons WHERE id = NEW.coupon_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Held all along: claimed at checkout, and never expired or cancelled since.
  SELECT true, email INTO v_claimed, v_claim_email FROM public.coupon_redemptions WHERE order_id = NEW.id;
  v_held := OLD.payment_status NOT IN ('expired', 'cancelled') AND coalesce(v_claimed, false);

  -- The use, if the checkout never claimed it. A use claimed with one email
  -- and paid with another keeps the claim email and records the payer's, so
  -- it counts for both.
  INSERT INTO public.coupon_redemptions AS r (order_id, coupon_id, email, customer_id, discount_cents)
  VALUES (NEW.id, NEW.coupon_id, v_email, NEW.customer_id, NEW.coupon_discount_cents)
  ON CONFLICT (order_id) DO UPDATE
    SET email = coalesce(r.email, EXCLUDED.email),
        payer_email = CASE WHEN r.email IS NOT NULL AND EXCLUDED.email IS NOT NULL AND EXCLUDED.email <> r.email
                           THEN EXCLUDED.email ELSE r.payer_email END,
        customer_id = coalesce(r.customer_id, EXCLUDED.customer_id);

  -- Only an order whose use was not held all along can be over the limit, and
  -- only by the uses the other orders hold or have paid. An order that kept its
  -- use is never flagged for the limits, whichever of them is paid first.
  IF NOT v_held AND (v_c.max_uses IS NOT NULL OR v_c.max_uses_per_customer IS NOT NULL) THEN
    SELECT * INTO v_uses FROM public.coupon_uses(NEW.coupon_id, v_email, NEW.customer_id, NEW.id);
    IF (v_c.max_uses IS NOT NULL AND v_uses.total >= v_c.max_uses)
       OR (v_c.max_uses_per_customer IS NOT NULL AND v_uses.by_customer >= v_c.max_uses_per_customer) THEN
      v_over := true;
    END IF;
  END IF;

  -- Held, but paid by another email: that payer's own other uses may already
  -- fill the per-customer limit.
  IF v_held AND v_c.max_uses_per_customer IS NOT NULL
     AND v_email IS NOT NULL AND v_claim_email IS NOT NULL AND v_email <> v_claim_email THEN
    SELECT * INTO v_uses FROM public.coupon_uses(NEW.coupon_id, v_email, NULL, NEW.id);
    IF v_uses.by_customer >= v_c.max_uses_per_customer THEN
      v_over := true;
    END IF;
  END IF;

  -- The payment may bring another email than the one claimed with: judged
  -- again on who paid, as coupon_price judges it (the account's email when
  -- none is given).
  IF NEW.customer_id IS NOT NULL THEN
    SELECT lower(u.email) INTO v_account_email FROM auth.users u WHERE u.id = NEW.customer_id;
  END IF;
  v_who := coalesce(v_email, v_account_email);
  IF cardinality(v_c.emails) > 0
     AND (v_who IS NULL OR NOT (v_who = ANY (v_c.emails))
          OR (v_c.emails_require_account AND v_account_email IS DISTINCT FROM v_who)) THEN
    v_wrong_who := true;
  END IF;
  IF v_c.first_order_only AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.paid_at IS NOT NULL AND o.id <> NEW.id
      AND ((v_who IS NOT NULL AND lower(o.customer_email) = v_who)
           OR (NEW.customer_id IS NOT NULL AND o.customer_id = NEW.customer_id))
  ) THEN
    v_wrong_who := true;
  END IF;

  IF v_over OR v_wrong_who THEN
    UPDATE public.orders SET coupon_over_limit = true WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_coupon_paid() FROM PUBLIC, anon, authenticated;

-- Paid: becomes 'paid', or gets its paid_at (apply_payment sends a payment
-- whose stock was released to review, with paid_at set: still a use).
DROP TRIGGER IF EXISTS orders_coupon_paid ON public.orders;
CREATE TRIGGER orders_coupon_paid
  AFTER UPDATE OF payment_status, paid_at ON public.orders
  FOR EACH ROW
  WHEN (NEW.coupon_id IS NOT NULL AND NEW.coupon_discount_cents > 0
        AND ((NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid')
             OR (NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL)))
  EXECUTE FUNCTION public.orders_coupon_paid();
