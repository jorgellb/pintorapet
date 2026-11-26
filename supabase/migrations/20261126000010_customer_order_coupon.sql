-- My account › an order: the coupon it was bought with and what it took off.
-- (customer_order is the one function that gives a customer their own order.)
-- coupon_discount_cents is what the customer saved, shipping included, as charged;
-- the items and the subtotal already carry the discounted prices.

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
    'coupon_code', v_order.coupon_code,
    'coupon_discount_cents', v_order.coupon_discount_cents,
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
