-- Guest order access: set token hash after reserve; lookup by reference + token.

CREATE OR REPLACE FUNCTION public.set_order_access_token(
  p_order_id uuid,
  p_access_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_access_token IS NULL OR length(p_access_token) < 24 THEN
    RAISE EXCEPTION 'INVALID_ACCESS_TOKEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET access_token_hash = encode(digest(p_access_token, 'sha256'), 'hex')
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

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
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_access_token(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_guest_order(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.set_order_access_token(uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.lookup_guest_order(text, text) TO service_role;
  END IF;
END;
$$;
