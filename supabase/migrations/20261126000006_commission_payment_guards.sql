-- Guards on paying for a commission (after review of 20261126000005):
-- a checkout quote is tied to the quote sent (price, VAT, weight and link), so
-- quoting again voids every quote worked out before; a commission is paid once
-- (a second payment goes to review); Bizum or transfer pass the same gates as
-- the shop's checkout (sales open, configuration unchanged).

CREATE OR REPLACE FUNCTION public.commission_quote_fingerprint(r public.commission_requests)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(digest(
    'commission:' || r.id || ':' || r.quote_cents || ':' || coalesce(r.quote_vat_rate, 21) || ':'
      || coalesce(r.quote_weight_grams, 0) || ':' || coalesce(r.pay_token_hash, ''),
    'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.commission_quote_fingerprint(public.commission_requests) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_commission_quote(
  p_reference text,
  p_token_hash text,
  p_cart_owner_hash text,
  p_country text,
  p_postal_code text,
  p_invoice_customer jsonb DEFAULT NULL
)
RETURNS public.checkout_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_request public.commission_requests%ROWTYPE;
  v_settings public.shop_settings%ROWTYPE;
  v_zone public.shipping_zones%ROWTYPE;
  v_weight integer;
  v_shipping integer;
  v_regime text;
  v_rate numeric;
  v_ship_rate numeric;
  v_unit integer;
  v_discount integer := 0;
  v_quote public.checkout_quotes%ROWTYPE;
BEGIN
  IF p_cart_owner_hash IS NULL OR length(p_cart_owner_hash) < 16 THEN
    RAISE EXCEPTION 'INVALID_CART_OWNER' USING ERRCODE = 'P0001';
  END IF;
  v_request := public.commission_for_payment(p_reference, p_token_hash);
  SELECT * INTO STRICT v_settings FROM public.shop_settings WHERE id = 1;

  IF p_country IS NULL OR p_country !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'SHIPPING_NO_DESTINATION' USING ERRCODE = 'P0001';
  END IF;
  IF upper(p_country) = 'ES' AND coalesce(p_postal_code, '') !~ '^\s*\d{5}\s*$' THEN
    RAISE EXCEPTION 'SHIPPING_POSTAL_CODE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_zone FROM public.shipping_zone_for(p_country, p_postal_code);
  IF v_zone.id IS NULL THEN
    RAISE EXCEPTION 'SHIPPING_NO_ZONE' USING ERRCODE = 'P0001';
  END IF;

  v_weight := coalesce(v_request.quote_weight_grams, 450)
    + coalesce((v_settings.shipping_config->>'packagingGrams')::integer, 0);
  SELECT price_cents INTO v_shipping FROM public.shipping_rates
  WHERE zone_id = v_zone.id AND max_grams >= v_weight ORDER BY max_grams LIMIT 1;
  IF v_shipping IS NULL THEN
    RAISE EXCEPTION 'SHIPPING_TOO_HEAVY' USING ERRCODE = 'P0001';
  END IF;
  IF v_zone.free_over_cents IS NOT NULL AND v_request.quote_cents >= v_zone.free_over_cents THEN
    v_shipping := 0;
  END IF;

  -- The same rule as the shop: no Spanish VAT where the destination pays none.
  v_regime := public.vat_regime(p_country, p_postal_code);
  v_rate := coalesce(v_request.quote_vat_rate, 21);
  v_ship_rate := coalesce((v_settings.invoice_config->>'shippingVatRate')::numeric, 21);
  v_unit := v_request.quote_cents;
  IF v_regime = 'no_vat' THEN
    v_discount := (v_unit - public.net_cents(v_unit, v_rate)) + (v_shipping - public.net_cents(v_shipping, v_ship_rate));
    v_unit := public.net_cents(v_unit, v_rate);
    v_shipping := public.net_cents(v_shipping, v_ship_rate);
  END IF;

  INSERT INTO public.checkout_quotes (
    cart_owner_hash, locale, lines, price_fingerprint, config_version,
    subtotal_cents, shipping_cents, tax_cents, total_cents, currency,
    shipping_zone, shipping_country, shipping_postal_code, shipping_zone_name,
    shipping_weight_grams, expires_at,
    vat_regime, vat_discount_cents, shipping_vat_rate, invoice_customer, commission_request_id
  ) VALUES (
    p_cart_owner_hash, v_request.locale,
    jsonb_build_array(jsonb_build_object(
      'product_id', NULL,
      'quantity', 1,
      'catalog_price_cents', v_request.quote_cents,
      'unit_price_cents', v_unit,
      'line_subtotal_cents', v_unit,
      'vat_rate', v_rate,
      'price_version', 0,
      'title', coalesce(nullif(v_request.quote_title, ''), CASE WHEN v_request.locale = 'es' THEN 'Retrato a lápiz por encargo' ELSE 'Commissioned pencil portrait' END),
      'sku', v_request.reference,
      'weight_grams', v_weight
    )),
    public.commission_quote_fingerprint(v_request),
    v_settings.config_version,
    v_unit, v_shipping, 0, v_unit + v_shipping, 'EUR',
    v_zone.id::text, upper(p_country), nullif(btrim(coalesce(p_postal_code, '')), ''),
    CASE WHEN v_request.locale = 'es' THEN v_zone.name_es ELSE v_zone.name_en END,
    v_weight, now() + make_interval(secs => v_settings.quote_ttl_seconds),
    v_regime, v_discount, v_ship_rate, p_invoice_customer, v_request.id
  )
  RETURNING * INTO v_quote;
  RETURN v_quote;
END;
$$;

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
    UPDATE public.orders SET commission_request_id = v_quote.commission_request_id WHERE id = v_order_id;
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
  v_paid_by uuid;
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

  -- A commission paid already by another order (two tabs, two payments): review it, refund the second.
  IF v_order.commission_request_id IS NOT NULL THEN
    SELECT paid_order_id INTO v_paid_by FROM public.commission_requests
    WHERE id = v_order.commission_request_id FOR UPDATE;
    IF v_paid_by IS NOT NULL AND v_paid_by <> v_order.id THEN
      UPDATE public.orders
      SET payment_status = 'review',
          stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
          stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
          paid_at = coalesce(paid_at, now())
      WHERE id = v_order.id;
      UPDATE public.stripe_events
      SET status = 'processed', processed_at = now(), last_error = 'COMMISSION_ALREADY_PAID'
      WHERE event_id = p_stripe_event_id;
      RETURN jsonb_build_object('order_id', v_order.id, 'status', 'review', 'reason', 'COMMISSION_ALREADY_PAID', 'replay', false);
    END IF;
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

  IF v_active_count = 0 AND v_order.commission_request_id IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.create_commission_manual_order(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_request public.commission_requests%ROWTYPE;
  v_quote public.checkout_quotes%ROWTYPE;
  v_method text := p->>'method';
  v_reference text;
  v_order_id uuid;
  v_line jsonb;
  v_settings public.shop_settings%ROWTYPE;
BEGIN
  IF v_method NOT IN ('bizum', 'transfer') THEN
    RAISE EXCEPTION 'MANUAL_ORDER_METHOD' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO STRICT v_settings FROM public.shop_settings WHERE id = 1 FOR SHARE;
  IF NOT v_settings.sales_enabled OR NOT v_settings.payments_enabled THEN
    RAISE EXCEPTION 'SALES_DISABLED' USING ERRCODE = 'P0001';
  END IF;
  v_request := public.commission_for_payment(p->>'reference', p->>'token_hash');
  SELECT * INTO v_request FROM public.commission_requests WHERE id = v_request.id FOR UPDATE;
  SELECT * INTO v_quote FROM public.checkout_quotes
  WHERE id = (p->>'quote_id')::uuid AND commission_request_id = v_request.id AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUOTE_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_quote.config_version <> v_settings.config_version
     OR v_quote.price_fingerprint <> public.commission_quote_fingerprint(v_request) THEN
    RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE = 'P0001';
  END IF;
  -- One order waiting at a time: a second click returns the first.
  SELECT id, reference INTO v_order_id, v_reference FROM public.orders
  WHERE commission_request_id = v_request.id AND payment_status = 'awaiting_transfer' LIMIT 1;
  IF v_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_reference, 'total_cents', v_quote.total_cents, 'replay', true);
  END IF;

  v_reference := 'PD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_line := v_quote.lines->0;
  INSERT INTO public.orders (
    reference, payment_status, fulfillment_status, locale, currency,
    subtotal_cents, shipping_cents, tax_cents, total_cents, access_token_hash,
    customer_email, customer_name, shipping_address, payment_provider,
    shipping_zone_id, shipping_zone_name, shipping_country, shipping_postal_code, shipping_weight_grams,
    vat_regime, invoice_customer, commission_request_id, customer_id
  ) VALUES (
    v_reference, 'awaiting_transfer', 'unfulfilled', v_request.locale, 'EUR',
    v_quote.subtotal_cents, v_quote.shipping_cents, 0, v_quote.total_cents,
    encode(digest(gen_random_uuid()::text || ':' || gen_random_uuid()::text, 'sha256'), 'hex'),
    lower(nullif(btrim(coalesce(p->'customer'->>'email', '')), '')),
    left(btrim(coalesce(p->'customer'->>'name', '')), 160),
    p->'address', v_method,
    v_quote.shipping_zone::uuid, v_quote.shipping_zone_name, v_quote.shipping_country, v_quote.shipping_postal_code,
    v_quote.shipping_weight_grams, v_quote.vat_regime, v_quote.invoice_customer, v_request.id,
    (SELECT u.id FROM auth.users u WHERE lower(u.email) = lower(p->'customer'->>'email') AND u.email_confirmed_at IS NOT NULL LIMIT 1)
  )
  RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, product_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents)
  VALUES (v_order_id, NULL, v_line->>'title', v_line->>'sku', (v_line->>'unit_price_cents')::integer, 1, (v_line->>'line_subtotal_cents')::integer);
  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_reference, 'total_cents', v_quote.total_cents, 'replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.create_commission_manual_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_commission_manual_order(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.manual_order_mark_paid(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN;
  END IF;
  IF v_order.payment_status <> 'awaiting_transfer' OR v_order.payment_provider NOT IN ('transfer', 'bizum', 'cash', 'terminal') THEN
    RAISE EXCEPTION 'ORDER_NOT_AWAITING_TRANSFER' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.commission_request_id IS NOT NULL THEN
    PERFORM 1 FROM public.commission_requests
    WHERE id = v_order.commission_request_id AND paid_order_id IS NOT NULL AND paid_order_id <> v_order.id
    FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'COMMISSION_ALREADY_PAID' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The reserved pieces leave the stock for good.
  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.quantity FROM public.order_items oi
    WHERE oi.order_id = v_order.id AND oi.product_id IS NOT NULL
    ORDER BY oi.product_id
  LOOP
    UPDATE public.inventory
    SET stock_on_hand = CASE WHEN inventory_mode = 'tracked' THEN stock_on_hand - v_item.quantity ELSE stock_on_hand END,
        stock_reserved = stock_reserved - v_item.quantity,
        version = version + 1
    WHERE product_id = v_item.product_id
      AND stock_reserved >= v_item.quantity
      AND (inventory_mode <> 'tracked' OR stock_on_hand >= v_item.quantity);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STOCK_CONSUME_FAILED' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.stock_movements (product_id, quantity_delta, reason, order_id, order_item_id, dedupe_key, note)
    VALUES (v_item.product_id, -v_item.quantity, 'sale', v_order.id, v_item.id,
            'sale:' || v_order.id || ':' || v_item.id,
            CASE WHEN v_order.market_id IS NOT NULL OR v_order.payment_provider IN ('cash', 'terminal') THEN 'Venta en mercado'
                 WHEN v_order.payment_provider = 'bizum' THEN 'Pedido por Bizum' ELSE 'Pedido por transferencia' END)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  -- Paid: the invoice is issued by the orders_issue_invoice trigger.
  UPDATE public.orders SET payment_status = 'paid', paid_at = now() WHERE id = v_order.id;

  IF nullif(btrim(coalesce(v_order.customer_email, '')), '') IS NOT NULL THEN
    INSERT INTO public.notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at)
    VALUES (
      'order_paid_customer:' || v_order.id || ':' || v_order.customer_email,
      v_order.customer_email,
      v_order.locale,
      'order_paid_customer',
      jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference),
      'pending',
      now()
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_order_mark_paid(uuid) FROM PUBLIC, anon, authenticated;
