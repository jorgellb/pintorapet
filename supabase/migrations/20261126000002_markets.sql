-- Markets (Admin › Mercados): where Meili sets up her stall, shown on the
-- public "Dónde estaré" page, and quick sales at the stall from her phone.
--
-- A stall sale is an order already paid (cash, card terminal or Bizum), with
-- no shipping and handed over at once: the stock leaves at the moment of the
-- sale, so the website and the stall never sell the same piece, and the
-- simplified invoice (ticket) is issued as for any paid order.

CREATE TABLE IF NOT EXISTS public.markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  place text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  hours text NOT NULL DEFAULT '',
  notes_es text NOT NULL DEFAULT '',
  notes_en text NOT NULL DEFAULT '',
  map_url text,
  -- Web orders can be picked up at this market (checkout, later).
  pickup boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT markets_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT markets_dates CHECK (ends_on >= starts_on),
  CONSTRAINT markets_map_url_https CHECK (map_url IS NULL OR map_url ~ '^https://'),
  CONSTRAINT markets_text_lengths CHECK (
    char_length(place) <= 200 AND char_length(city) <= 100 AND char_length(hours) <= 80
    AND char_length(notes_es) <= 500 AND char_length(notes_en) <= 500
  )
);

CREATE INDEX IF NOT EXISTS markets_dates_idx ON public.markets (ends_on, starts_on);

DROP TRIGGER IF EXISTS markets_set_updated_at ON public.markets;
CREATE TRIGGER markets_set_updated_at
  BEFORE UPDATE ON public.markets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS markets_public_read ON public.markets;
CREATE POLICY markets_public_read ON public.markets
  FOR SELECT TO anon, authenticated USING (published OR public.is_admin());
DROP POLICY IF EXISTS markets_admin_write ON public.markets;
CREATE POLICY markets_admin_write ON public.markets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.markets FROM PUBLIC, anon;
GRANT SELECT ON public.markets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.markets TO authenticated;

-- The market a sale (or, later, a pickup) belongs to.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS market_id uuid REFERENCES public.markets (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_market_idx ON public.orders (market_id) WHERE market_id IS NOT NULL;

-- Paid at the stall: cash or a card terminal (as well as Bizum).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_known;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_provider_known
  CHECK (payment_provider IN ('stripe', 'paypal', 'transfer', 'bizum', 'cash', 'terminal'));
ALTER TABLE public.order_refunds DROP CONSTRAINT IF EXISTS order_refunds_provider_check;
ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_provider_check
  CHECK (provider IN ('stripe', 'paypal', 'transfer', 'bizum', 'cash', 'terminal'));

-- Marked paid: also a stall sale.
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

-- p: { lines: [{ product_id, quantity }], method: 'cash' | 'terminal' | 'bizum',
--      market_id?, customer?: { name?, email? }, locale? }
CREATE OR REPLACE FUNCTION public.admin_market_sale(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_method text := coalesce(nullif(p->>'method', ''), 'cash');
  v_market uuid := nullif(p->>'market_id', '')::uuid;
  v_name text := left(nullif(btrim(coalesce(p->'customer'->>'name', '')), ''), 160);
  v_email text := lower(nullif(btrim(coalesce(p->'customer'->>'email', '')), ''));
  v_quote jsonb;
  v_line jsonb;
  v_inv public.inventory%ROWTYPE;
  v_qty integer;
  v_reference text;
  v_order_id uuid;
  v_cover uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_method NOT IN ('cash', 'terminal', 'bizum') THEN
    RAISE EXCEPTION 'MARKET_SALE_METHOD' USING ERRCODE = 'P0001';
  END IF;
  IF v_market IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.markets WHERE id = v_market) THEN
    RAISE EXCEPTION 'MARKET_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'MANUAL_ORDER_EMAIL' USING ERRCODE = 'P0001';
  END IF;

  -- Catalogue prices with Spanish VAT, no shipping: the piece is handed over.
  v_quote := public.manual_order_quote(jsonb_build_object(
    'lines', p->'lines', 'country', 'ES', 'postal_code', '28001',
    'locale', coalesce(p->>'locale', 'es'), 'shipping_cents', 0));

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
    customer_email, customer_name, payment_provider, shipping_country, vat_regime, market_id, customer_id
  ) VALUES (
    v_reference, 'awaiting_transfer', 'unfulfilled', (v_quote->>'locale')::public.locale_code, 'EUR',
    (v_quote->>'subtotal_cents')::integer, 0, 0, (v_quote->>'subtotal_cents')::integer,
    encode(digest(gen_random_uuid()::text || ':' || gen_random_uuid()::text, 'sha256'), 'hex'),
    v_email, coalesce(v_name, 'Venta en mercado'), v_method, 'ES', v_quote->>'vat_regime', v_market,
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
            (v_line->>'unit_price_cents')::integer, v_qty, (v_line->>'line_subtotal_cents')::integer, v_cover);
    UPDATE public.inventory SET stock_reserved = stock_reserved + v_qty, version = version + 1
    WHERE product_id = (v_line->>'product_id')::uuid;
  END LOOP;

  -- Paid now: the stock leaves, the ticket is issued, the customer emailed if one was given.
  PERFORM public.manual_order_mark_paid(v_order_id);
  UPDATE public.orders SET fulfillment_status = 'completed' WHERE id = v_order_id;

  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_reference,
                            'total_cents', (v_quote->>'subtotal_cents')::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_market_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_sale(jsonb) TO authenticated;
