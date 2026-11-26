-- Bizum, as well as bank transfer, for orders taken by phone (Admin › Pedidos › Nuevo pedido).
-- Same flow as a transfer: created awaiting the payment ('awaiting_transfer',
-- read as "awaiting a manual payment"), marked paid by hand when it arrives,
-- refunds registered by hand. Only the provider recorded changes.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_known;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_provider_known CHECK (payment_provider IN ('stripe', 'paypal', 'transfer', 'bizum'));

ALTER TABLE public.order_refunds DROP CONSTRAINT IF EXISTS order_refunds_provider_check;
ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_provider_check CHECK (provider IN ('stripe', 'paypal', 'transfer', 'bizum'));

-- Marked paid: a transfer or a Bizum.
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
  IF v_order.payment_status <> 'awaiting_transfer' OR v_order.payment_provider NOT IN ('transfer', 'bizum') THEN
    RAISE EXCEPTION 'ORDER_NOT_AWAITING_TRANSFER' USING ERRCODE = 'P0001';
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
            CASE v_order.payment_provider WHEN 'bizum' THEN 'Pedido por Bizum' ELSE 'Pedido por transferencia' END)
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

-- p.method: 'transfer' (default) or 'bizum'.
CREATE OR REPLACE FUNCTION public.admin_create_manual_order(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_quote jsonb;
  v_line jsonb;
  v_inv public.inventory%ROWTYPE;
  v_qty integer;
  v_name text := btrim(coalesce(p->'customer'->>'name', ''));
  v_email text := lower(nullif(btrim(coalesce(p->'customer'->>'email', '')), ''));
  v_phone text := left(nullif(btrim(coalesce(p->'customer'->>'phone', '')), ''), 30);
  v_address jsonb;
  v_invoice jsonb;
  v_tax text;
  v_inv_country text;
  v_reference text;
  v_order_id uuid;
  v_cover uuid;
  v_item_id uuid;
  v_method text := coalesce(nullif(p->>'method', ''), 'transfer');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_method NOT IN ('transfer', 'bizum') THEN
    RAISE EXCEPTION 'MANUAL_ORDER_METHOD' USING ERRCODE = 'P0001';
  END IF;

  v_quote := public.manual_order_quote(p);
  IF (v_quote->>'shipping_cents') IS NULL THEN
    RAISE EXCEPTION 'SHIPPING_%', coalesce(v_quote->>'shipping_reason', 'UNAVAILABLE') USING ERRCODE = 'P0001';
  END IF;

  IF length(v_name) < 2 OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'MANUAL_ORDER_NAME' USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'MANUAL_ORDER_EMAIL' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(coalesce(p->'address'->>'line1', ''))) < 3
     OR v_quote->>'postal_code' IS NULL
     OR length(btrim(coalesce(p->'address'->>'city', ''))) < 2 THEN
    RAISE EXCEPTION 'MANUAL_ORDER_ADDRESS' USING ERRCODE = 'P0001';
  END IF;
  v_address := jsonb_strip_nulls(jsonb_build_object(
    'name', left(coalesce(nullif(btrim(coalesce(p->'address'->>'name', '')), ''), v_name), 160),
    'line1', left(btrim(p->'address'->>'line1'), 200),
    'line2', left(nullif(btrim(coalesce(p->'address'->>'line2', '')), ''), 200),
    'postal_code', v_quote->>'postal_code',
    'city', left(btrim(p->'address'->>'city'), 100),
    'state', left(nullif(btrim(coalesce(p->'address'->>'state', '')), ''), 100),
    'country', v_quote->>'country',
    'phone', v_phone,
    'note', left(nullif(btrim(coalesce(p->'address'->>'note', '')), ''), 500)
  ));

  -- Invoice data: same rules as the web (checkoutCustomer.ts / request_full_invoice).
  IF jsonb_typeof(p->'invoice_customer') = 'object' THEN
    v_tax := upper(regexp_replace(coalesce(p->'invoice_customer'->>'taxId', ''), '[^A-Za-z0-9]', '', 'g'));
    v_inv_country := upper(btrim(coalesce(p->'invoice_customer'->>'country', '')));
    IF v_inv_country !~ '^[A-Z]{2}$'
       OR (v_inv_country = 'ES' AND NOT public.spanish_tax_id_ok(v_tax))
       OR (v_inv_country <> 'ES' AND v_tax !~ '^[A-Z0-9]{4,20}$') THEN
      RAISE EXCEPTION 'INVALID_TAX_ID' USING ERRCODE = 'P0001';
    END IF;
    IF length(btrim(coalesce(p->'invoice_customer'->>'name', ''))) < 2
       OR length(btrim(coalesce(p->'invoice_customer'->>'address', ''))) < 3
       OR length(btrim(coalesce(p->'invoice_customer'->>'postalCode', ''))) < 1
       OR length(btrim(coalesce(p->'invoice_customer'->>'city', ''))) < 2 THEN
      RAISE EXCEPTION 'INVALID_INVOICE_CUSTOMER' USING ERRCODE = 'P0001';
    END IF;
    v_invoice := jsonb_build_object(
      'taxId', v_tax,
      'name', left(btrim(p->'invoice_customer'->>'name'), 160),
      'address', left(btrim(p->'invoice_customer'->>'address'), 200),
      'postalCode', left(btrim(p->'invoice_customer'->>'postalCode'), 12),
      'city', left(btrim(p->'invoice_customer'->>'city'), 100),
      'country', v_inv_country
    );
  END IF;

  -- Reserve the pieces, in a fixed order (no deadlock with the web's checkout).
  FOR v_line IN SELECT e FROM jsonb_array_elements(v_quote->'lines') e ORDER BY (e->>'product_id')::uuid
  LOOP
    v_qty := (v_line->>'quantity')::integer;
    SELECT * INTO v_inv FROM public.inventory WHERE product_id = (v_line->>'product_id')::uuid FOR UPDATE;
    IF v_inv.inventory_mode = 'tracked' AND v_inv.stock_on_hand - v_inv.stock_reserved < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: %', v_line->>'sku' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_reference := 'PD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.orders (
    reference, payment_status, fulfillment_status, locale, currency,
    subtotal_cents, shipping_cents, tax_cents, total_cents, access_token_hash,
    customer_email, customer_name, shipping_address, payment_provider,
    shipping_zone_id, shipping_zone_name, shipping_country, shipping_postal_code, shipping_weight_grams,
    vat_regime, invoice_customer, customer_id
  ) VALUES (
    v_reference, 'awaiting_transfer', 'unfulfilled', (v_quote->>'locale')::public.locale_code, 'EUR',
    (v_quote->>'subtotal_cents')::integer, (v_quote->>'shipping_cents')::integer, 0, (v_quote->>'total_cents')::integer,
    encode(digest(gen_random_uuid()::text || ':' || gen_random_uuid()::text, 'sha256'), 'hex'),
    v_email, v_name, v_address, v_method,
    (v_quote->>'zone_id')::uuid, v_quote->>'zone_name', v_quote->>'country', v_quote->>'postal_code',
    (v_quote->>'weight_grams')::integer,
    v_quote->>'vat_regime', v_invoice,
    (SELECT u.id FROM auth.users u WHERE v_email IS NOT NULL AND lower(u.email) = v_email AND u.email_confirmed_at IS NOT NULL LIMIT 1)
  )
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT e FROM jsonb_array_elements(v_quote->'lines') e ORDER BY (e->>'product_id')::uuid
  LOOP
    v_qty := (v_line->>'quantity')::integer;
    SELECT media_asset_id INTO v_cover FROM public.product_images
    WHERE product_id = (v_line->>'product_id')::uuid ORDER BY is_cover DESC, position LIMIT 1;
    INSERT INTO public.order_items (order_id, product_id, product_title, product_sku, unit_price_cents, quantity, line_subtotal_cents, media_asset_id)
    VALUES (v_order_id, (v_line->>'product_id')::uuid, v_line->>'title', v_line->>'sku',
            (v_line->>'unit_price_cents')::integer, v_qty, (v_line->>'line_subtotal_cents')::integer, v_cover)
    RETURNING id INTO v_item_id;
    -- Reserved like the web's checkout: no ledger line until it is sold or freed.
    UPDATE public.inventory SET stock_reserved = stock_reserved + v_qty, version = version + 1
    WHERE product_id = (v_line->>'product_id')::uuid;
  END LOOP;

  IF coalesce((p->>'paid')::boolean, false) THEN
    PERFORM public.manual_order_mark_paid(v_order_id);
  END IF;

  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_reference,
                            'total_cents', (v_quote->>'total_cents')::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_manual_order(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_order(jsonb) TO authenticated;
