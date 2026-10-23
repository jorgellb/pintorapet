-- Pets Drawings · transactional commerce functions (§9.5, §11)
-- SECURITY DEFINER + fixed search_path; EXECUTE revoked from PUBLIC/anon.

-- ---------------------------------------------------------------------------
-- Composite types for quote / reserve inputs
-- ---------------------------------------------------------------------------

CREATE TYPE public.cart_line_input AS (
  product_id uuid,
  quantity integer
);

CREATE TYPE public.quote_line_result AS (
  product_id uuid,
  quantity integer,
  unit_price_cents integer,
  line_subtotal_cents integer,
  price_version integer,
  title text,
  sku text,
  slug text
);

-- ---------------------------------------------------------------------------
-- create_checkout_quote
-- Canonical quote from cart lines. Does NOT reserve inventory.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_checkout_quote(
  p_cart_owner_hash text,
  p_locale public.locale_code,
  p_lines public.cart_line_input[],
  p_shipping_zone text DEFAULT NULL
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
BEGIN
  IF p_cart_owner_hash IS NULL OR length(p_cart_owner_hash) < 16 THEN
    RAISE EXCEPTION 'INVALID_CART_OWNER' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO STRICT v_settings FROM public.shop_settings WHERE id = 1;

  -- Merge duplicate product lines
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

  -- Deterministic product order
  FOR v_line IN
    SELECT * FROM unnest(v_merged) AS l
    ORDER BY (l).product_id
  LOOP
    v_qty := (v_line).quantity;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > v_settings.cart_max_qty_per_line THEN
      RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_line).product_id;

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
        'slug', v_tr.slug
      )
    );
  END LOOP;

  IF v_units > v_settings.cart_max_units THEN
    RAISE EXCEPTION 'CART_TOO_MANY_UNITS' USING ERRCODE = 'P0001';
  END IF;

  v_fingerprint := v_fingerprint || 'cfg:' || v_settings.config_version::text;
  v_total := v_subtotal + v_shipping + v_tax;

  INSERT INTO public.checkout_quotes (
    cart_owner_hash,
    locale,
    lines,
    price_fingerprint,
    config_version,
    subtotal_cents,
    shipping_cents,
    tax_cents,
    total_cents,
    currency,
    shipping_zone,
    expires_at
  ) VALUES (
    p_cart_owner_hash,
    p_locale,
    v_lines_json,
    encode(digest(v_fingerprint, 'sha256'), 'hex'),
    v_settings.config_version,
    v_subtotal,
    v_shipping,
    v_tax,
    v_total,
    'EUR',
    p_shipping_zone,
    now() + make_interval(secs => v_settings.quote_ttl_seconds)
  )
  RETURNING * INTO v_quote;

  RETURN v_quote;
END;
$$;

-- ---------------------------------------------------------------------------
-- reserve_checkout
-- All-or-nothing reservation + pending order + attempt in one transaction.
-- Locks inventory rows in product_id order.
-- ---------------------------------------------------------------------------

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
SET search_path = pg_catalog, public
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

  -- Idempotent replay
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

  -- Collect and sort product IDs for deterministic locking
  SELECT array_agg((elem->>'product_id')::uuid ORDER BY (elem->>'product_id')::uuid)
  INTO v_sorted_ids
  FROM jsonb_array_elements(v_quote.lines) AS elem;

  -- Lock inventory in deterministic order, validate all lines
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

    IF v_product.price_cents <> (v_line->>'unit_price_cents')::integer
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
      || v_product.price_cents::text || ';';
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

-- ---------------------------------------------------------------------------
-- attach_stripe_session
-- Persist Stripe session on the correct attempt after network create.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attach_stripe_session(
  p_attempt_id uuid,
  p_stripe_session_id text,
  p_stripe_payload jsonb,
  p_session_expires_at timestamptz
)
RETURNS public.checkout_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
  FROM public.checkout_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent if already attached to the same session
  IF v_attempt.stripe_session_id IS NOT NULL THEN
    IF v_attempt.stripe_session_id = p_stripe_session_id THEN
      RETURN v_attempt;
    END IF;
    RAISE EXCEPTION 'SESSION_ALREADY_ATTACHED' USING ERRCODE = 'P0001';
  END IF;

  IF v_attempt.status NOT IN ('creating_session', 'session_open') THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_ATTACHABLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.checkout_attempts
  SET
    stripe_session_id = p_stripe_session_id,
    stripe_payload = p_stripe_payload,
    session_expires_at = p_session_expires_at,
    status = 'session_open'
  WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;

  UPDATE public.orders
  SET
    payment_status = 'checkout_open',
    stripe_session_id = p_stripe_session_id
  WHERE id = v_attempt.order_id
    AND payment_status IN ('pending_session', 'checkout_open');

  RETURN v_attempt;
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_payment
-- Idempotent: consume active reservations once; create outbox rows once.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_payment(
  p_order_id uuid,
  p_stripe_event_id text,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
  p_amount_total_cents integer,
  p_currency text DEFAULT 'EUR',
  p_customer_email text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_res public.stock_reservations%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_active_count integer;
BEGIN
  IF p_currency IS DISTINCT FROM 'EUR' THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- Record event row early (unique); do not mark processed until done
  INSERT INTO public.stripe_events (event_id, event_type, related_object_id, status, payload_summary)
  VALUES (
    p_stripe_event_id,
    'checkout.session.completed',
    coalesce(p_stripe_session_id, p_order_id::text),
    'processing',
    jsonb_build_object(
      'order_id', p_order_id,
      'amount_total_cents', p_amount_total_cents,
      'session_id', p_stripe_session_id
    )
  )
  ON CONFLICT (event_id) DO NOTHING;

  -- If this event was already fully processed, short-circuit after locking the order

  IF EXISTS (
    SELECT 1 FROM public.stripe_events
    WHERE event_id = p_stripe_event_id AND status = 'processed'
  ) THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'status', 'paid',
      'replay', true
    );
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    UPDATE public.stripe_events
    SET status = 'processed', processed_at = coalesce(processed_at, now())
    WHERE event_id = p_stripe_event_id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'paid', 'replay', true);
  END IF;

  IF v_order.payment_status IN ('refunded', 'cancelled') THEN
    RAISE EXCEPTION 'ORDER_NOT_PAYABLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.total_cents <> p_amount_total_cents THEN
    UPDATE public.orders SET payment_status = 'review' WHERE id = v_order.id;
    UPDATE public.stripe_events
    SET status = 'failed', last_error = 'AMOUNT_MISMATCH', attempt_count = attempt_count + 1
    WHERE event_id = p_stripe_event_id;
    RAISE EXCEPTION 'AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_attempt
  FROM public.checkout_attempts
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  SELECT count(*) INTO v_active_count
  FROM public.stock_reservations
  WHERE checkout_attempt_id = v_attempt.id AND status = 'active';

  IF v_active_count = 0 THEN
    -- Paid without usable reservation → review, do not force negative stock
    UPDATE public.orders
    SET
      payment_status = 'review',
      stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
      stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
      customer_email = coalesce(p_customer_email, customer_email),
      customer_name = coalesce(p_customer_name, customer_name),
      shipping_address = coalesce(p_shipping_address, shipping_address),
      paid_at = coalesce(paid_at, now())
    WHERE id = v_order.id;

    UPDATE public.stripe_events
    SET status = 'processed', processed_at = now(), last_error = 'PAID_WITHOUT_RESERVATION'
    WHERE event_id = p_stripe_event_id;

    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status', 'review',
      'reason', 'PAID_WITHOUT_RESERVATION',
      'replay', false
    );
  END IF;

  -- Consume reservations + decrement stock deterministically
  FOR v_res IN
    SELECT * FROM public.stock_reservations
    WHERE checkout_attempt_id = v_attempt.id AND status = 'active'
    ORDER BY product_id
    FOR UPDATE
  LOOP
    SELECT * INTO v_item
    FROM public.order_items
    WHERE order_id = p_order_id AND product_id = v_res.product_id
    LIMIT 1;

    -- tracked: decrement on_hand + reserved; made_to_order: reserved only
    UPDATE public.inventory
    SET
      stock_on_hand = CASE
        WHEN inventory_mode = 'tracked' THEN stock_on_hand - v_res.quantity
        ELSE stock_on_hand
      END,
      stock_reserved = stock_reserved - v_res.quantity,
      version = version + 1
    WHERE product_id = v_res.product_id
      AND stock_reserved >= v_res.quantity
      AND (
        inventory_mode <> 'tracked'
        OR stock_on_hand >= v_res.quantity
      );

    IF NOT FOUND THEN
      UPDATE public.orders SET payment_status = 'review' WHERE id = v_order.id;
      RAISE EXCEPTION 'STOCK_CONSUME_FAILED' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.stock_reservations
    SET status = 'consumed', consumed_at = now()
    WHERE id = v_res.id AND status = 'active';

    INSERT INTO public.stock_movements (
      product_id,
      quantity_delta,
      reason,
      order_id,
      order_item_id,
      reservation_id,
      dedupe_key
    ) VALUES (
      v_res.product_id,
      -v_res.quantity,
      'sale',
      p_order_id,
      v_item.id,
      v_res.id,
      'sale:' || p_order_id::text || ':' || v_item.id::text
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  UPDATE public.orders
  SET
    payment_status = 'paid',
    stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
    customer_email = coalesce(p_customer_email, customer_email),
    customer_name = coalesce(p_customer_name, customer_name),
    shipping_address = coalesce(p_shipping_address, shipping_address),
    paid_at = now()
  WHERE id = v_order.id;

  UPDATE public.checkout_attempts
  SET status = 'paid'
  WHERE id = v_attempt.id;

  -- Durable notifications (unique per type/order/recipient)
  INSERT INTO public.notification_outbox (
    dedupe_key, recipient, locale, template_key, payload, status, next_run_at
  ) VALUES (
    'order_paid_customer:' || v_order.id::text || ':' || coalesce(p_customer_email, 'unknown'),
    coalesce(p_customer_email, ''),
    v_order.locale,
    'order_paid_customer',
    jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference),
    'pending',
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.notification_outbox (
    dedupe_key, recipient, locale, template_key, payload, status, next_run_at
  ) VALUES (
    'order_paid_admin:' || v_order.id::text || ':admin',
    'admin',
    v_order.locale,
    'order_paid_admin',
    jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference),
    'pending',
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  UPDATE public.stripe_events
  SET status = 'processed', processed_at = now()
  WHERE event_id = p_stripe_event_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'replay', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- release_reservations
-- Conditional release: only active rows; idempotent; no double restock.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_reservations(
  p_attempt_id uuid,
  p_reason text DEFAULT 'expired'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_res public.stock_reservations%ROWTYPE;
  v_released integer := 0;
  v_new_status public.checkout_attempt_status;
  v_order_status public.order_payment_status;
BEGIN
  SELECT * INTO v_attempt
  FROM public.checkout_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Already terminal / paid — do not release
  IF v_attempt.status IN ('paid', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'status', v_attempt.status,
      'released', 0,
      'replay', true
    );
  END IF;

  -- Guard: if order already paid, never release
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = v_attempt.order_id AND o.payment_status = 'paid'
  ) THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'status', 'paid',
      'released', 0,
      'replay', true
    );
  END IF;

  FOR v_res IN
    SELECT * FROM public.stock_reservations
    WHERE checkout_attempt_id = p_attempt_id AND status = 'active'
    ORDER BY product_id
    FOR UPDATE
  LOOP
    UPDATE public.inventory
    SET
      stock_reserved = stock_reserved - v_res.quantity,
      version = version + 1
    WHERE product_id = v_res.product_id
      AND stock_reserved >= v_res.quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RELEASE_INVARIANT_BROKEN' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.stock_reservations
    SET status = 'released', released_at = now()
    WHERE id = v_res.id AND status = 'active';

    -- Informational ledger row (on_hand unchanged; reserved already decreased)
    INSERT INTO public.stock_movements (
      product_id,
      quantity_delta,
      reason,
      order_id,
      reservation_id,
      dedupe_key,
      note
    ) VALUES (
      v_res.product_id,
      v_res.quantity,
      'release',
      v_attempt.order_id,
      v_res.id,
      'release:' || p_attempt_id::text || ':' || v_res.id::text,
      p_reason
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_released := v_released + 1;
  END LOOP;

  IF p_reason = 'cancelled' THEN
    v_new_status := 'cancelled';
    v_order_status := 'cancelled';
  ELSE
    v_new_status := 'expired';
    v_order_status := 'expired';
  END IF;

  UPDATE public.checkout_attempts
  SET status = v_new_status
  WHERE id = p_attempt_id
    AND status NOT IN ('paid', 'cancelled', 'expired');

  UPDATE public.orders
  SET payment_status = v_order_status
  WHERE id = v_attempt.order_id
    AND payment_status NOT IN ('paid', 'refunded', 'partially_refunded', 'review');

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', v_new_status,
    'released', v_released,
    'replay', v_released = 0
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- adjust_inventory (admin panel)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_product_id uuid,
  p_stock_on_hand integer,
  p_inventory_mode public.inventory_mode,
  p_admin_user_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inv public.inventory%ROWTYPE;
  v_delta integer;
BEGIN
  IF p_admin_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = p_admin_user_id AND is_active
  ) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  IF p_stock_on_hand IS NULL OR p_stock_on_hand < 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.inventory WHERE product_id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_stock_on_hand < v_inv.stock_reserved AND p_inventory_mode = 'tracked' THEN
    RAISE EXCEPTION 'STOCK_BELOW_RESERVED' USING ERRCODE = 'P0001';
  END IF;

  v_delta := p_stock_on_hand - v_inv.stock_on_hand;

  UPDATE public.inventory
  SET
    stock_on_hand = p_stock_on_hand,
    inventory_mode = p_inventory_mode,
    verified_at = CASE
      WHEN p_inventory_mode = 'unverified' THEN NULL
      ELSE coalesce(verified_at, now())
    END,
    version = version + 1
  WHERE product_id = p_product_id
  RETURNING * INTO v_inv;

  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements (
      product_id, quantity_delta, reason, admin_user_id, dedupe_key, note
    ) VALUES (
      p_product_id,
      v_delta,
      'admin_adjust',
      p_admin_user_id,
      'admin_adjust:' || p_product_id::text || ':' || v_inv.version::text || ':' || gen_random_uuid()::text,
      p_note
    );
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, operation, entity_type, entity_id, change
  ) VALUES (
    p_admin_user_id,
    'adjust_inventory',
    'inventory',
    p_product_id::text,
    jsonb_build_object(
      'stock_on_hand', p_stock_on_hand,
      'inventory_mode', p_inventory_mode,
      'delta', v_delta
    )
  );

  RETURN v_inv;
END;
$$;

-- ---------------------------------------------------------------------------
-- claim_outbox — FOR UPDATE SKIP LOCKED lease
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_outbox(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60,
  p_worker_id text DEFAULT 'worker'
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.status IN ('pending', 'failed')
      AND o.next_run_at <= now()
      AND (o.lease_until IS NULL OR o.lease_until < now())
    ORDER BY o.next_run_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 100))
  )
  UPDATE public.notification_outbox o
  SET
    status = 'leased',
    lease_until = now() + make_interval(secs => greatest(5, coalesce(p_lease_seconds, 60))),
    lease_owner = p_worker_id,
    attempt_count = o.attempt_count + 1
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: revoke public/anon execute on privileged functions
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_checkout(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_stripe_session(uuid, text, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_payment(uuid, text, text, text, integer, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reservations(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_inventory(uuid, integer, public.inventory_mode, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_outbox(integer, integer, text) FROM PUBLIC;

-- Backend uses service_role (bypasses RLS). Grant when the role exists (Supabase).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_checkout_quote(text, public.locale_code, public.cart_line_input[], text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.reserve_checkout(uuid, text, uuid, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.attach_stripe_session(uuid, text, jsonb, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_payment(uuid, text, text, text, integer, text, text, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.release_reservations(uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, integer, public.inventory_mode, uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_outbox(integer, integer, text) TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, integer, public.inventory_mode, uuid, text) TO authenticated;
  END IF;
END;
$$;
