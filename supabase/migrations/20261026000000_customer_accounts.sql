-- Customer accounts: profile, orders linked to the account, and read access
-- to the customer's own orders. See docs/superpowers/specs/2026-10-24-cuentas-clientes-design.md

-- ---------------------------------------------------------------------------
-- 1. Profile
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '' CHECK (length(full_name) <= 120),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 32),
  -- { line1, line2, city, state, postal_code, country }
  address jsonb CHECK (address IS NULL OR jsonb_typeof(address) = 'object'),
  -- { taxId, name, address, postalCode, city, country } (same shape as invoice_customer)
  billing jsonb CHECK (billing IS NULL OR jsonb_typeof(billing) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS customers_set_updated_at ON public.customers;
CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_own_select ON public.customers;
CREATE POLICY customers_own_select ON public.customers
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS customers_own_insert ON public.customers;
CREATE POLICY customers_own_insert ON public.customers
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS customers_own_update ON public.customers;
CREATE POLICY customers_own_update ON public.customers
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS customers_admin_select ON public.customers;
CREATE POLICY customers_admin_select ON public.customers
  FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Orders linked to an account
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_customer_email_lower_idx ON public.orders (lower(customer_email));

-- Orders the signed-in customer may see: linked to the account, or placed
-- with the account's email once that email is confirmed.
CREATE OR REPLACE FUNCTION public.customer_can_see_order(p_order public.orders)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF p_order.customer_id = v_uid THEN
    RETURN true;
  END IF;
  SELECT email, email_confirmed_at INTO v_email, v_confirmed FROM auth.users WHERE id = v_uid;
  RETURN v_confirmed IS NOT NULL
    AND v_email IS NOT NULL
    AND lower(p_order.customer_email) = lower(v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_can_see_order(public.orders) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The customer's orders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_orders()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY (row->>'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'reference', o.reference,
        'created_at', o.created_at,
        'paid_at', o.paid_at,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status,
        'total_cents', o.total_cents,
        'currency', o.currency,
        'shipped_at', o.shipped_at,
        'item_count', (SELECT coalesce(sum(oi.quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
        'items', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'title', oi.product_title,
            'quantity', oi.quantity,
            'product_id', oi.product_id
          ) ORDER BY oi.created_at, oi.id), '[]'::jsonb)
          FROM public.order_items oi WHERE oi.order_id = o.id
        )
      ) AS row
      FROM public.orders o
      WHERE public.customer_can_see_order(o)
        AND o.payment_status NOT IN ('pending_session', 'checkout_open', 'expired', 'cancelled')
    ) rows
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_orders() TO authenticated;

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
        'total_cents', i.total_cents
      ) ORDER BY i.issued_at), '[]'::jsonb)
      FROM public.invoices i WHERE i.order_id = v_order.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_order(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_order(text) TO authenticated;
