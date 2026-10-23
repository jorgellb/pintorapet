-- Invoices for customers: download their own, and ask for a full invoice with
-- their tax id after paying. A full invoice issued in place of a simplified
-- one is Veri*factu type F3 and points at the invoice it replaces.
-- See docs/superpowers/specs/2026-10-24-cuentas-clientes-design.md

-- ---------------------------------------------------------------------------
-- 1. One original invoice per order, plus at most one replacement
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS replaces_invoice_id uuid UNIQUE REFERENCES public.invoices(id);

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_order_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_original_per_order
  ON public.invoices (order_id) WHERE replaces_invoice_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_replacement_per_order
  ON public.invoices (order_id) WHERE replaces_invoice_id IS NOT NULL;

-- The invoice that counts for an order: the replacement if there is one.
CREATE OR REPLACE FUNCTION public.current_invoice(p_order_id uuid)
RETURNS public.invoices
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.*
  FROM public.invoices i
  WHERE i.order_id = p_order_id
  ORDER BY (i.replaces_invoice_id IS NOT NULL) DESC, i.issued_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_invoice(uuid) FROM PUBLIC, anon, authenticated;

-- Readers that assumed one invoice per order now take the current one.
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
    'invoice_number', (public.current_invoice(v_order.id)).full_number,
    'invoice_kind', (public.current_invoice(v_order.id)).kind,
    'invoice_issued_at', (public.current_invoice(v_order.id)).issued_at
  );
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
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF p_reference IS NULL OR p_access_token IS NULL OR length(p_access_token) < 24 THEN
    RAISE EXCEPTION 'INVALID_LOOKUP' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE reference = p_reference LIMIT 1;
  IF NOT FOUND
     OR v_order.access_token_hash IS DISTINCT FROM encode(digest(p_access_token, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'ORDER_LOOKUP_DENIED' USING ERRCODE = 'P0001';
  END IF;

  v_invoice := public.current_invoice(v_order.id);
  IF v_invoice.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_order(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE reference = btrim(p_reference);
  IF NOT FOUND
     OR NOT public.customer_can_see_order(v_order)
     OR v_order.payment_status IN ('pending_session', 'checkout_open', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'reference', v_order.reference,
    'created_at', v_order.created_at,
    'paid_at', v_order.paid_at,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'locale', v_order.locale,
    'customer_email', v_order.customer_email,
    'customer_name', v_order.customer_name,
    'shipping_address', v_order.shipping_address,
    'shipping_zone_name', v_order.shipping_zone_name,
    'carrier', v_order.carrier,
    'tracking_code', v_order.tracking_code,
    'shipped_at', v_order.shipped_at,
    'subtotal_cents', v_order.subtotal_cents,
    'shipping_cents', v_order.shipping_cents,
    'tax_cents', v_order.tax_cents,
    'total_cents', v_order.total_cents,
    'invoice_customer', v_order.invoice_customer,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'title', oi.product_title,
        'sku', oi.product_sku,
        'product_id', oi.product_id,
        'quantity', oi.quantity,
        'unit_price_cents', oi.unit_price_cents,
        'line_subtotal_cents', oi.line_subtotal_cents
      ) ORDER BY oi.created_at, oi.id), '[]'::jsonb)
      FROM public.order_items oi WHERE oi.order_id = v_order.id
    ),
    'invoices', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'kind', i.kind,
        'full_number', i.full_number,
        'issued_at', i.issued_at,
        'total_cents', i.total_cents,
        'replaces_invoice_id', i.replaces_invoice_id
      ) ORDER BY i.issued_at), '[]'::jsonb)
      FROM public.invoices i WHERE i.order_id = v_order.id
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. A customer's own invoice, for the PDF
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
    (SELECT r.full_number FROM public.invoices r WHERE r.id = v_invoice.replaces_invoice_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_invoice(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Full invoice on request
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_full_invoice(p_reference text, p_customer jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_current public.invoices%ROWTYPE;
  v_customer jsonb;
  v_tax text;
  v_country text;
  v_cfg jsonb;
  v_prefix text;
  v_year integer;
  v_number integer;
  v_full text;
  v_prev text;
  v_at timestamptz;
  v_local timestamp;
  v_off interval;
  v_stamp text;
  v_issued_on text;
  v_hash text;
  v_qr text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE reference = btrim(p_reference) FOR UPDATE;
  IF NOT FOUND OR NOT public.customer_can_see_order(v_order) THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'INVOICE_ORDER_NOT_PAID' USING ERRCODE = 'P0001';
  END IF;

  -- Same rules as src/lib/domain/checkoutCustomer.ts (invoiceCustomerSchema)
  v_tax := upper(regexp_replace(coalesce(p_customer->>'taxId', ''), '[^A-Za-z0-9]', '', 'g'));
  v_country := upper(btrim(coalesce(p_customer->>'country', '')));
  IF v_country !~ '^[A-Z]{2}$'
     OR (v_country = 'ES' AND NOT public.spanish_tax_id_ok(v_tax))
     OR (v_country <> 'ES' AND v_tax !~ '^[A-Z0-9]{4,20}$') THEN
    RAISE EXCEPTION 'INVALID_TAX_ID' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(coalesce(p_customer->>'name', ''))) < 2
     OR length(btrim(coalesce(p_customer->>'address', ''))) < 3
     OR length(btrim(coalesce(p_customer->>'postalCode', ''))) < 1
     OR length(btrim(coalesce(p_customer->>'city', ''))) < 2 THEN
    RAISE EXCEPTION 'INVALID_INVOICE_CUSTOMER' USING ERRCODE = 'P0001';
  END IF;
  v_customer := jsonb_build_object(
    'taxId', v_tax,
    'name', left(btrim(p_customer->>'name'), 160),
    'address', left(btrim(p_customer->>'address'), 200),
    'postalCode', left(btrim(p_customer->>'postalCode'), 12),
    'city', left(btrim(p_customer->>'city'), 100),
    'country', v_country
  );

  v_current := public.current_invoice(v_order.id);
  IF v_current.id IS NOT NULL AND v_current.kind = 'full' THEN
    RETURN jsonb_build_object('status', 'already', 'invoice_id', v_current.id);
  END IF;

  UPDATE public.orders SET invoice_customer = v_customer WHERE id = v_order.id;

  -- Not issued yet: it will be issued as a full invoice.
  IF v_current.id IS NULL THEN
    IF coalesce(public.invoice_config_complete(), false) IS NOT TRUE THEN
      RETURN jsonb_build_object('status', 'saved');
    END IF;
    v_id := public.issue_invoice(v_order.id);
    RETURN jsonb_build_object('status', 'issued', 'invoice_id', v_id);
  END IF;

  -- A simplified invoice exists: issue a full one in its place (F3), same amounts.
  IF coalesce(public.invoice_config_complete(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'INVOICE_CONFIG_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;
  SELECT invoice_config INTO v_cfg FROM public.shop_settings WHERE id = 1;
  v_prefix := coalesce(nullif(btrim(v_cfg->>'fullPrefix'), ''), 'F');
  v_year := extract(year FROM timezone('Europe/Madrid', now()))::integer;

  INSERT INTO public.invoice_series (code, year) VALUES (v_prefix, v_year)
  ON CONFLICT (code, year) DO NOTHING;
  SELECT next_number INTO v_number FROM public.invoice_series
  WHERE code = v_prefix AND year = v_year FOR UPDATE;
  UPDATE public.invoice_series SET next_number = v_number + 1
  WHERE code = v_prefix AND year = v_year;
  v_full := v_prefix || v_year::text || '-' || lpad(v_number::text, 4, '0');

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
    v_current.issuer->>'issuerNif', v_full, v_issued_on, 'F3',
    v_current.vat_cents, v_current.total_cents, coalesce(v_prev, ''), v_stamp
  );
  v_qr := 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
       || '?nif=' || (v_current.issuer->>'issuerNif')
       || '&numserie=' || v_full
       || '&fecha=' || v_issued_on
       || '&importe=' || public.verifactu_amount(v_current.total_cents);

  INSERT INTO public.invoices (
    order_id, kind, series, number, full_number, issued_at, operation_date,
    issuer, customer, lines, breakdown, base_cents, vat_cents, total_cents,
    vat_regime, exemption_note, locale, prev_hash, hash, record_generated_at, qr_url,
    replaces_invoice_id
  ) VALUES (
    v_order.id, 'full', v_prefix, v_number, v_full, v_at, v_current.operation_date,
    v_current.issuer, v_customer, v_current.lines, v_current.breakdown,
    v_current.base_cents, v_current.vat_cents, v_current.total_cents,
    v_current.vat_regime, v_current.exemption_note, v_current.locale,
    v_prev, v_hash, v_at, v_qr, v_current.id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'issued', 'invoice_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_full_invoice(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_full_invoice(text, jsonb) TO authenticated;
