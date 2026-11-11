-- Refunds and rectifying invoices (Admin › Pedidos › Devolver dinero).
-- See docs/superpowers/specs/2026-11-11-devoluciones-etiquetas-design.md
--
-- A refund gives back some units of the order's lines and, optionally, its
-- shipping. It goes through Stripe or PayPal (or is registered when it was made
-- there), puts the units back in stock if asked, moves the order to
-- partially_refunded / refunded, emails the customer and issues a Veri*factu
-- rectifying invoice "por diferencias": R5 when it rectifies a simplified
-- invoice, R1 a full one, in its own series (invoice_config.rectifyingPrefix,
-- "R" by default). Without tax data the rectifying invoice waits for
-- admin_issue_pending_invoices, like any invoice.

-- ---------------------------------------------------------------------------
-- 1. Invoices: rectifying ones
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS rectifies_invoice_id uuid REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS rectification_reason text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_kind_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('simplified', 'full', 'rectifying'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_rectifying_shape;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_rectifying_shape CHECK (
    (kind = 'rectifying') = (rectifies_invoice_id IS NOT NULL)
    AND (rectifies_invoice_id IS NULL OR replaces_invoice_id IS NULL)
  );

-- One original invoice per order: rectifying invoices are not originals.
DROP INDEX IF EXISTS public.invoices_one_original_per_order;
CREATE UNIQUE INDEX invoices_one_original_per_order
  ON public.invoices (order_id) WHERE replaces_invoice_id IS NULL AND rectifies_invoice_id IS NULL;
CREATE INDEX IF NOT EXISTS invoices_rectifies_idx ON public.invoices (rectifies_invoice_id);

-- The invoice that counts for an order: the replacement if there is one, never a rectifying one.
CREATE OR REPLACE FUNCTION public.current_invoice(p_order_id uuid)
RETURNS public.invoices
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.*
  FROM public.invoices i
  WHERE i.order_id = p_order_id AND i.rectifies_invoice_id IS NULL
  ORDER BY (i.replaces_invoice_id IS NOT NULL) DESC, i.issued_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_invoice(uuid) FROM PUBLIC, anon, authenticated;

-- Once an invoice has been rectified it cannot be replaced by a full one:
-- the rectifying invoice points at it.
CREATE OR REPLACE FUNCTION public.invoices_no_replacement_after_rectifying()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.replaces_invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.order_id = NEW.order_id AND i.kind = 'rectifying'
  ) THEN
    RAISE EXCEPTION 'INVOICE_RECTIFIED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_no_replacement_after_rectifying ON public.invoices;
CREATE TRIGGER invoices_no_replacement_after_rectifying
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_no_replacement_after_rectifying();

-- ---------------------------------------------------------------------------
-- 2. Refunds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  -- pending: being sent to Stripe/PayPal · succeeded · failed
  -- unassigned: made in Stripe/PayPal for part of the order; Meili says which pieces
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'unassigned')),
  -- api: our button · manual: registered by Meili · provider: seen in a webhook
  channel text NOT NULL CHECK (channel IN ('api', 'manual', 'provider')),
  provider text CHECK (provider IN ('stripe', 'paypal')),
  provider_refund_id text UNIQUE,
  -- [{ "order_item_id": uuid, "quantity": n, "amount_cents": n }]
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipping_cents integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  restock boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 300),
  error text,
  invoice_id uuid REFERENCES public.invoices(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON public.order_refunds (order_id, created_at);
-- One refund on its way per order: a double click cannot pay back twice.
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_one_pending
  ON public.order_refunds (order_id) WHERE status = 'pending';

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_refunds_admin_read ON public.order_refunds;
CREATE POLICY order_refunds_admin_read ON public.order_refunds
  FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.order_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_refunds TO authenticated;
GRANT ALL ON public.order_refunds TO service_role;

-- What is left to refund in an order: units per line, shipping, money.
CREATE OR REPLACE FUNCTION public.refund_left(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH taken AS (
    SELECT (e->>'order_item_id')::uuid AS item_id, sum((e->>'quantity')::integer) AS qty
    FROM public.order_refunds r, jsonb_array_elements(r.items) e
    WHERE r.order_id = p_order_id AND r.status IN ('pending', 'succeeded')
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'order_item_id', oi.id,
        'quantity', oi.quantity - coalesce(t.qty, 0),
        'unit_price_cents', oi.unit_price_cents
      ) ORDER BY oi.created_at, oi.id)
      FROM public.order_items oi LEFT JOIN taken t ON t.item_id = oi.id
      WHERE oi.order_id = p_order_id
    ), '[]'::jsonb),
    'shipping_cents', CASE WHEN EXISTS (
        SELECT 1 FROM public.order_refunds r
        WHERE r.order_id = p_order_id AND r.status IN ('pending', 'succeeded') AND r.shipping_cents > 0
      ) THEN 0 ELSE (SELECT coalesce(o.shipping_cents, 0) FROM public.orders o WHERE o.id = p_order_id) END,
    'refunded_cents', (
      SELECT coalesce(sum(r.amount_cents), 0) FROM public.order_refunds r
      WHERE r.order_id = p_order_id AND r.status IN ('pending', 'succeeded', 'unassigned')
    ),
    'unassigned_cents', (
      SELECT coalesce(sum(r.amount_cents), 0) FROM public.order_refunds r
      WHERE r.order_id = p_order_id AND r.status = 'unassigned'
    )
  );
$$;

-- Internal: the admin reads it through admin_refund_left.
REVOKE ALL ON FUNCTION public.refund_left(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. issue_invoice: as in 20261025000000_invoices.sql, but refunded orders get
-- their invoice too, and the original is the one that is not rectifying.
-- ---------------------------------------------------------------------------

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
  -- Refunded orders still get their invoice, so their rectifying invoices have one to rectify.
  IF v_order.payment_status NOT IN ('paid', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'INVOICE_ORDER_NOT_PAID' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing FROM public.invoices WHERE order_id = v_order.id AND rectifies_invoice_id IS NULL
  ORDER BY issued_at LIMIT 1;
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


-- ---------------------------------------------------------------------------
-- 3. The rectifying invoice of a refund (por diferencias: negative amounts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_rectifying_invoice(p_refund_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_refund public.order_refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_original public.invoices%ROWTYPE;
  v_cfg jsonb;
  v_prefix text;
  v_year integer;
  v_number integer;
  v_full text;
  v_item record;
  v_rate numeric;
  v_gross integer;
  v_line_base integer;
  v_line_vat integer;
  v_key text;
  v_lines jsonb := '[]'::jsonb;
  v_breakdown jsonb := '{}'::jsonb;
  v_base integer := 0;
  v_vat integer := 0;
  v_total integer;
  v_issuer jsonb;
  v_prev text;
  v_at timestamptz;
  v_local timestamp;
  v_off interval;
  v_stamp text;
  v_issued_on text;
  v_tipo text;
  v_hash text;
  v_qr text;
  v_id uuid;
BEGIN
  SELECT * INTO v_refund FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status <> 'succeeded' THEN
    RAISE EXCEPTION 'REFUND_NOT_DONE' USING ERRCODE = 'P0001';
  END IF;
  IF v_refund.invoice_id IS NOT NULL THEN
    RETURN v_refund.invoice_id;
  END IF;
  IF coalesce(public.invoice_config_complete(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'INVOICE_CONFIG_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;
  v_original := public.current_invoice(v_order.id);
  IF v_original.id IS NULL THEN
    PERFORM public.issue_invoice(v_order.id);
    v_original := public.current_invoice(v_order.id);
  END IF;

  SELECT invoice_config INTO v_cfg FROM public.shop_settings WHERE id = 1;
  v_prefix := coalesce(nullif(btrim(v_cfg->>'rectifyingPrefix'), ''), 'R');
  v_year := extract(year FROM timezone('Europe/Madrid', now()))::integer;

  INSERT INTO public.invoice_series (code, year) VALUES (v_prefix, v_year)
  ON CONFLICT (code, year) DO NOTHING;
  SELECT next_number INTO v_number FROM public.invoice_series
  WHERE code = v_prefix AND year = v_year FOR UPDATE;
  UPDATE public.invoice_series SET next_number = v_number + 1
  WHERE code = v_prefix AND year = v_year;
  v_full := v_prefix || v_year::text || '-' || lpad(v_number::text, 4, '0');

  -- Each refunded line takes the VAT rate of its line in the original invoice:
  -- issue_invoice writes the order's lines in this same order, then shipping.
  FOR v_item IN
    WITH lines AS (
      SELECT oi.id, oi.product_title, oi.unit_price_cents,
             row_number() OVER (ORDER BY oi.created_at, oi.id) AS position
      FROM public.order_items oi WHERE oi.order_id = v_order.id
    )
    SELECT l.product_title, l.unit_price_cents, sum((e->>'quantity')::integer) AS quantity,
           (v_original.lines -> (l.position - 1)::integer ->> 'vatRate')::numeric AS vat_rate
    FROM jsonb_array_elements(v_refund.items) e
    JOIN lines l ON l.id = (e->>'order_item_id')::uuid
    GROUP BY l.position, l.product_title, l.unit_price_cents
    ORDER BY l.position
  LOOP
    v_rate := coalesce(v_item.vat_rate, 21);
    v_gross := v_item.unit_price_cents * v_item.quantity;
    v_line_base := public.net_cents(v_gross, v_rate);
    v_line_vat := v_gross - v_line_base;
    v_base := v_base - v_line_base;
    v_vat := v_vat - v_line_vat;
    v_key := CASE WHEN v_rate = trunc(v_rate) THEN trunc(v_rate)::integer::text
                  ELSE trim(trailing '.' FROM trim(trailing '0' FROM v_rate::text)) END;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_item.product_title,
      'quantity', -v_item.quantity,
      'unitNetCents', public.net_cents(v_item.unit_price_cents, v_rate),
      'vatRate', v_rate,
      'baseCents', -v_line_base,
      'vatCents', -v_line_vat,
      'totalCents', -v_gross
    ));
    v_breakdown := jsonb_set(v_breakdown, ARRAY[v_key], jsonb_build_object(
      'base', coalesce((v_breakdown -> v_key ->> 'base')::integer, 0) - v_line_base,
      'vat', coalesce((v_breakdown -> v_key ->> 'vat')::integer, 0) - v_line_vat
    ), true);
  END LOOP;

  IF v_refund.shipping_cents > 0 THEN
    v_rate := coalesce((v_original.lines -> (jsonb_array_length(v_original.lines) - 1) ->> 'vatRate')::numeric, 21);
    v_gross := v_refund.shipping_cents;
    v_line_base := public.net_cents(v_gross, v_rate);
    v_line_vat := v_gross - v_line_base;
    v_base := v_base - v_line_base;
    v_vat := v_vat - v_line_vat;
    v_key := CASE WHEN v_rate = trunc(v_rate) THEN trunc(v_rate)::integer::text
                  ELSE trim(trailing '.' FROM trim(trailing '0' FROM v_rate::text)) END;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', CASE WHEN v_order.locale = 'en' THEN 'Shipping' ELSE 'Envío' END,
      'quantity', -1,
      'unitNetCents', v_line_base,
      'vatRate', v_rate,
      'baseCents', -v_line_base,
      'vatCents', -v_line_vat,
      'totalCents', -v_gross
    ));
    v_breakdown := jsonb_set(v_breakdown, ARRAY[v_key], jsonb_build_object(
      'base', coalesce((v_breakdown -> v_key ->> 'base')::integer, 0) - v_line_base,
      'vat', coalesce((v_breakdown -> v_key ->> 'vat')::integer, 0) - v_line_vat
    ), true);
  END IF;

  v_total := v_base + v_vat;
  IF v_total <> -v_refund.amount_cents THEN
    RAISE EXCEPTION 'REFUND_INVOICE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_issuer := jsonb_build_object(
    'issuerName', btrim(v_cfg->>'issuerName'),
    'issuerNif', btrim(v_cfg->>'issuerNif'),
    'issuerAddress', btrim(v_cfg->>'issuerAddress'),
    'issuerPostalCode', btrim(v_cfg->>'issuerPostalCode'),
    'issuerCity', btrim(v_cfg->>'issuerCity'),
    'issuerKind', coalesce(nullif(btrim(v_cfg->>'issuerKind'), ''), 'autonomo')
  );
  -- Art. 80.Dos LIVA (devolución): R1 for a full invoice, R5 for a simplified one.
  v_tipo := CASE WHEN v_original.kind = 'simplified' THEN 'R5' ELSE 'R1' END;

  PERFORM pg_advisory_xact_lock(872023::bigint);
  SELECT hash INTO v_prev FROM public.invoices ORDER BY record_generated_at DESC, id DESC LIMIT 1;

  v_at := clock_timestamp();
  v_local := timezone('Europe/Madrid', v_at);
  v_off := v_local - timezone('UTC', v_at);
  v_stamp := to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS')
          || CASE WHEN v_off >= interval '0' THEN '+' ELSE '-' END
          || to_char(abs(extract(epoch FROM v_off))::integer * interval '1 second', 'HH24:MI');
  v_issued_on := to_char(v_local, 'DD-MM-YYYY');
  v_hash := public.verifactu_hash(
    v_issuer->>'issuerNif', v_full, v_issued_on, v_tipo, v_vat, v_total, coalesce(v_prev, ''), v_stamp
  );
  v_qr := 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
       || '?nif=' || (v_issuer->>'issuerNif')
       || '&numserie=' || v_full
       || '&fecha=' || v_issued_on
       || '&importe=' || public.verifactu_amount(v_total);

  INSERT INTO public.invoices (
    order_id, kind, series, number, full_number, issued_at, operation_date,
    issuer, customer, lines, breakdown, base_cents, vat_cents, total_cents,
    vat_regime, exemption_note, locale, prev_hash, hash, record_generated_at, qr_url,
    rectifies_invoice_id, rectification_reason
  ) VALUES (
    v_order.id, 'rectifying', v_prefix, v_number, v_full, v_at,
    (timezone('Europe/Madrid', coalesce(v_refund.completed_at, v_at)))::date,
    v_issuer, v_original.customer, v_lines, v_breakdown, v_base, v_vat, v_total,
    v_original.vat_regime, v_original.exemption_note, v_original.locale,
    v_prev, v_hash, v_at, v_qr, v_original.id, nullif(btrim(v_refund.reason), '')
  )
  RETURNING id INTO v_id;

  UPDATE public.order_refunds SET invoice_id = v_id WHERE id = v_refund.id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_rectifying_invoice(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Completing a refund: stock, order status, rectifying invoice, email
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_refund(p_refund_id uuid, p_provider_refund_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_refund public.order_refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item record;
  v_refunded integer;
BEGIN
  SELECT * INTO v_refund FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_refund.status = 'succeeded' THEN
    RETURN;
  END IF;
  IF v_refund.status NOT IN ('pending', 'unassigned') THEN
    RAISE EXCEPTION 'REFUND_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;

  UPDATE public.order_refunds
  SET status = 'succeeded',
      provider_refund_id = coalesce(nullif(btrim(p_provider_refund_id), ''), provider_refund_id),
      completed_at = now(),
      error = NULL
  WHERE id = v_refund.id;

  -- Back to stock: only pieces whose stock is counted.
  IF v_refund.restock THEN
    FOR v_item IN
      SELECT oi.id AS order_item_id, oi.product_id, sum((e->>'quantity')::integer) AS quantity
      FROM jsonb_array_elements(v_refund.items) e
      JOIN public.order_items oi ON oi.id = (e->>'order_item_id')::uuid
      JOIN public.inventory inv ON inv.product_id = oi.product_id AND inv.inventory_mode = 'tracked'
      GROUP BY oi.id, oi.product_id
    LOOP
      UPDATE public.inventory
      SET stock_on_hand = stock_on_hand + v_item.quantity, version = version + 1
      WHERE product_id = v_item.product_id;
      INSERT INTO public.stock_movements (
        product_id, quantity_delta, reason, order_id, order_item_id, admin_user_id, dedupe_key, note
      ) VALUES (
        v_item.product_id, v_item.quantity, 'return_restock', v_order.id, v_item.order_item_id,
        v_refund.created_by, 'refund:' || v_refund.id || ':' || v_item.order_item_id, 'Devolución ' || v_order.reference
      )
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  END IF;

  SELECT coalesce(sum(amount_cents), 0) INTO v_refunded
  FROM public.order_refunds
  WHERE order_id = v_order.id AND status IN ('succeeded', 'unassigned');
  UPDATE public.orders
  SET payment_status = CASE WHEN v_refunded >= v_order.total_cents THEN 'refunded' ELSE 'partially_refunded' END::public.order_payment_status
  WHERE id = v_order.id;

  -- The rectifying invoice; without tax data it waits for admin_issue_pending_invoices.
  BEGIN
    PERFORM public.issue_rectifying_invoice(v_refund.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'issue_rectifying_invoice %: %', v_refund.id, SQLERRM;
  END;

  IF v_order.customer_email IS NOT NULL THEN
    INSERT INTO public.notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at)
    VALUES (
      'order_refunded_customer:' || v_refund.id,
      v_order.customer_email,
      v_order.locale,
      'order_refunded_customer',
      jsonb_build_object(
        'order_id', v_order.id,
        'reference', v_order.reference,
        'amount_cents', v_refund.amount_cents,
        'provider', coalesce(v_refund.provider, v_order.payment_provider),
        'full', v_refunded >= v_order.total_cents
      ),
      'pending',
      now()
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_refund(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. What the admin calls
-- ---------------------------------------------------------------------------

-- Validates and saves a refund. Through Stripe/PayPal it stays "pending" until
-- admin_complete_refund / admin_fail_refund; registered by hand (p_manual) it
-- is completed here, taking over a refund seen in a webhook if there is one.
CREATE OR REPLACE FUNCTION public.admin_begin_refund(
  p_order_id uuid,
  p_items jsonb,
  p_shipping boolean,
  p_restock boolean,
  p_reason text,
  p_manual boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_left jsonb;
  v_want record;
  v_items jsonb := '[]'::jsonb;
  v_amount integer := 0;
  v_shipping integer := 0;
  v_unassigned public.order_refunds%ROWTYPE;
  v_provider text;
  v_ref text;
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' OR length(coalesce(p_reason, '')) > 300 THEN
    RAISE EXCEPTION 'REFUND_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status = 'refunded' THEN
    RAISE EXCEPTION 'REFUND_TOO_MUCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'REFUND_NOT_PAID' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_refunds WHERE order_id = v_order.id AND status = 'pending') THEN
    RAISE EXCEPTION 'REFUND_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  v_left := public.refund_left(v_order.id);

  -- Units asked for, per line of this order.
  FOR v_want IN
    SELECT (e->>'order_item_id')::uuid AS item_id, sum((e->>'quantity')::integer) AS quantity
    FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    GROUP BY 1
  LOOP
    IF v_want.quantity IS NULL OR v_want.quantity < 0 THEN
      RAISE EXCEPTION 'REFUND_INVALID' USING ERRCODE = '22023';
    END IF;
    CONTINUE WHEN v_want.quantity = 0;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_left->'items') l
      WHERE (l->>'order_item_id')::uuid = v_want.item_id
    ) THEN
      RAISE EXCEPTION 'REFUND_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_want.quantity > (
      SELECT (l->>'quantity')::integer FROM jsonb_array_elements(v_left->'items') l
      WHERE (l->>'order_item_id')::uuid = v_want.item_id
    ) THEN
      RAISE EXCEPTION 'REFUND_TOO_MUCH' USING ERRCODE = 'P0001';
    END IF;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'order_item_id', v_want.item_id,
      'quantity', v_want.quantity,
      'amount_cents', v_want.quantity * (
        SELECT (l->>'unit_price_cents')::integer FROM jsonb_array_elements(v_left->'items') l
        WHERE (l->>'order_item_id')::uuid = v_want.item_id
      )
    ));
  END LOOP;
  SELECT coalesce(sum((e->>'amount_cents')::integer), 0) INTO v_amount FROM jsonb_array_elements(v_items) e;

  IF p_shipping AND coalesce(v_order.shipping_cents, 0) > 0 THEN
    v_shipping := (v_left->>'shipping_cents')::integer;
    IF v_shipping = 0 THEN
      RAISE EXCEPTION 'REFUND_TOO_MUCH' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_amount := v_amount + v_shipping;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'REFUND_EMPTY' USING ERRCODE = 'P0001';
  END IF;

  -- Registered by hand: it takes over a refund seen in Stripe/PayPal, same amount.
  IF p_manual THEN
    SELECT * INTO v_unassigned FROM public.order_refunds
    WHERE order_id = v_order.id AND status = 'unassigned'
    ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_unassigned.amount_cents <> v_amount THEN
        RAISE EXCEPTION 'REFUND_AMOUNT_MISMATCH: %', v_unassigned.amount_cents USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.order_refunds
      SET items = v_items, shipping_cents = v_shipping, restock = coalesce(p_restock, false),
          reason = coalesce(btrim(p_reason), ''), created_by = auth.uid()
      WHERE id = v_unassigned.id;
      PERFORM public.complete_refund(v_unassigned.id, NULL);
      RETURN jsonb_build_object('refund_id', v_unassigned.id, 'amount_cents', v_amount, 'status', 'succeeded');
    END IF;
    IF v_amount > v_order.total_cents - (v_left->>'refunded_cents')::integer THEN
      RAISE EXCEPTION 'REFUND_TOO_MUCH' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.order_refunds (order_id, status, channel, provider, items, shipping_cents, amount_cents, restock, reason, created_by)
    VALUES (v_order.id, 'pending', 'manual', v_order.payment_provider, v_items, v_shipping, v_amount,
            coalesce(p_restock, false), coalesce(btrim(p_reason), ''), auth.uid())
    RETURNING id INTO v_id;
    PERFORM public.complete_refund(v_id, NULL);
    RETURN jsonb_build_object('refund_id', v_id, 'amount_cents', v_amount, 'status', 'succeeded');
  END IF;

  IF v_amount > v_order.total_cents - (v_left->>'refunded_cents')::integer THEN
    RAISE EXCEPTION 'REFUND_TOO_MUCH' USING ERRCODE = 'P0001';
  END IF;
  v_provider := coalesce(v_order.payment_provider, 'stripe');
  v_ref := CASE WHEN v_provider = 'paypal' THEN v_order.paypal_capture_id ELSE v_order.stripe_payment_intent_id END;
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'REFUND_NO_PAYMENT' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.order_refunds (order_id, status, channel, provider, items, shipping_cents, amount_cents, restock, reason, created_by)
  VALUES (v_order.id, 'pending', 'api', v_provider, v_items, v_shipping, v_amount,
          coalesce(p_restock, false), coalesce(btrim(p_reason), ''), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'refund_id', v_id,
    'amount_cents', v_amount,
    'provider', v_provider,
    'payment_ref', v_ref,
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_begin_refund(uuid, jsonb, boolean, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_begin_refund(uuid, jsonb, boolean, boolean, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_complete_refund(p_refund_id uuid, p_provider_refund_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM public.complete_refund(p_refund_id, p_provider_refund_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_complete_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_refund(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_fail_refund(p_refund_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.order_refunds
  SET status = 'failed', error = left(coalesce(p_error, ''), 500), completed_at = now()
  WHERE id = p_refund_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_fail_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fail_refund(uuid, text) TO authenticated;

-- What is left to refund, for the admin's refund form.
CREATE OR REPLACE FUNCTION public.admin_refund_left(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN public.refund_left(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_left(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_left(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Refunds seen in Stripe/PayPal webhooks
-- ---------------------------------------------------------------------------

-- Returns: known (already recorded) · completed (one of ours, pending) ·
-- assigned (all that was left) · unassigned (part: Meili says which pieces) ·
-- unknown_order.
CREATE OR REPLACE FUNCTION public.record_provider_refund(
  p_provider text,
  p_payment_ref text,
  p_provider_refund_id text,
  p_amount_cents integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_refund public.order_refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_left jsonb;
  v_items jsonb;
  v_amount integer;
  v_id uuid;
BEGIN
  IF p_provider NOT IN ('stripe', 'paypal') OR coalesce(p_amount_cents, 0) <= 0 OR btrim(coalesce(p_provider_refund_id, '')) = '' THEN
    RAISE EXCEPTION 'REFUND_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund FROM public.order_refunds WHERE provider_refund_id = p_provider_refund_id FOR UPDATE;
  IF FOUND THEN
    IF v_refund.status = 'pending' THEN
      PERFORM public.complete_refund(v_refund.id, p_provider_refund_id);
      RETURN 'completed';
    END IF;
    RETURN 'known';
  END IF;

  SELECT * INTO v_order FROM public.orders
  WHERE (p_provider = 'stripe' AND stripe_payment_intent_id = p_payment_ref)
     OR (p_provider = 'paypal' AND paypal_capture_id = p_payment_ref)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unknown_order';
  END IF;

  -- One of ours whose answer has not come back yet: same amount, still pending.
  SELECT * INTO v_refund FROM public.order_refunds
  WHERE order_id = v_order.id AND status = 'pending' AND channel = 'api'
    AND provider_refund_id IS NULL AND amount_cents = p_amount_cents
  FOR UPDATE;
  IF FOUND THEN
    PERFORM public.complete_refund(v_refund.id, p_provider_refund_id);
    RETURN 'completed';
  END IF;

  v_left := public.refund_left(v_order.id);
  v_amount := v_order.total_cents - (v_left->>'refunded_cents')::integer;

  -- All that was left, with nothing waiting to be assigned: every piece left and the shipping.
  IF p_amount_cents = v_amount AND (v_left->>'unassigned_cents')::integer = 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'order_item_id', l->>'order_item_id',
      'quantity', (l->>'quantity')::integer,
      'amount_cents', (l->>'quantity')::integer * (l->>'unit_price_cents')::integer
    )), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_left->'items') l
    WHERE (l->>'quantity')::integer > 0;
    INSERT INTO public.order_refunds (order_id, status, channel, provider, provider_refund_id, items, shipping_cents, amount_cents, reason)
    VALUES (v_order.id, 'pending', 'provider', p_provider, p_provider_refund_id, v_items,
            (v_left->>'shipping_cents')::integer, p_amount_cents,
            CASE WHEN p_provider = 'paypal' THEN 'Devuelto desde PayPal' ELSE 'Devuelto desde Stripe' END)
    RETURNING id INTO v_id;
    PERFORM public.complete_refund(v_id, NULL);
    RETURN 'assigned';
  END IF;

  INSERT INTO public.order_refunds (order_id, status, channel, provider, provider_refund_id, amount_cents, reason)
  VALUES (v_order.id, 'unassigned', 'provider', p_provider, p_provider_refund_id, p_amount_cents,
          CASE WHEN p_provider = 'paypal' THEN 'Devuelto desde PayPal' ELSE 'Devuelto desde Stripe' END);
  UPDATE public.orders
  SET payment_status = CASE
    WHEN (v_left->>'refunded_cents')::integer + p_amount_cents >= total_cents THEN 'refunded'
    ELSE 'partially_refunded' END::public.order_payment_status
  WHERE id = v_order.id AND payment_status IN ('paid', 'partially_refunded');
  RETURN 'unassigned';
END;
$$;

REVOKE ALL ON FUNCTION public.record_provider_refund(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_refund(text, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Pending invoices: originals (refunded orders too), then rectifying ones
-- ---------------------------------------------------------------------------

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
    WHERE o.payment_status IN ('paid', 'partially_refunded', 'refunded')
      AND o.paid_at IS NOT NULL
      AND (public.current_invoice(o.id)).id IS NULL
    ORDER BY o.paid_at, o.id
  LOOP
    PERFORM public.issue_invoice(v_id);
    v_count := v_count + 1;
  END LOOP;
  FOR v_id IN
    SELECT r.id FROM public.order_refunds r
    WHERE r.status = 'succeeded' AND r.invoice_id IS NULL
    ORDER BY r.completed_at, r.id
  LOOP
    PERFORM public.issue_rectifying_invoice(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Refund emails go out at once, like the other order emails.
CREATE OR REPLACE FUNCTION public.claim_outbox_for_order(
  p_order_id uuid,
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
    WHERE o.payload->>'order_id' = p_order_id::text
      AND o.template_key IN ('order_paid_customer', 'order_paid_admin', 'order_shipped_customer', 'order_refunded_customer')
      AND o.status IN ('pending', 'failed')
      AND o.next_run_at <= now()
      AND (o.lease_until IS NULL OR o.lease_until < now())
    FOR UPDATE SKIP LOCKED
    LIMIT 10
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

REVOKE ALL ON FUNCTION public.claim_outbox_for_order(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_for_order(uuid, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. A customer's own invoice: a rectifying one says which invoice it rectifies
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_invoice.order_id;
  IF NOT public.customer_can_see_order(v_order) THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  RETURN to_jsonb(v_invoice) || jsonb_build_object(
    'replaces_number',
    (SELECT r.full_number FROM public.invoices r WHERE r.id = v_invoice.replaces_invoice_id),
    'rectifies_number',
    (SELECT r.full_number FROM public.invoices r WHERE r.id = v_invoice.rectifies_invoice_id),
    'rectifies_issued_at',
    (SELECT r.issued_at FROM public.invoices r WHERE r.id = v_invoice.rectifies_invoice_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_invoice(uuid) TO authenticated;
