-- Picking a web order up at a market (checkout): no shipping, no address.
--
-- The quote is the usual one with no destination, then marked as a pickup in
-- Spain (Spanish VAT, no shipping) at a market that allows it and has not
-- ended. The order copies the market from the quote, as it copies the
-- shipping zone (checkout_attempts_copy_shipping).

ALTER TABLE public.checkout_quotes
  ADD COLUMN IF NOT EXISTS pickup_market_id uuid REFERENCES public.markets (id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.create_pickup_quote(
  p_cart_owner_hash text,
  p_locale public.locale_code,
  p_lines public.cart_line_input[],
  p_market_id uuid,
  p_invoice_customer jsonb DEFAULT NULL
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

  v_quote := public.create_checkout_quote(p_cart_owner_hash, p_locale, p_lines, NULL, NULL, p_invoice_customer);

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

REVOKE ALL ON FUNCTION public.create_pickup_quote(text, public.locale_code, public.cart_line_input[], uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pickup_quote(text, public.locale_code, public.cart_line_input[], uuid, jsonb) TO service_role;

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
      pickup = q.pickup_market_id IS NOT NULL
  FROM public.checkout_quotes q
  WHERE q.id = NEW.quote_id AND o.id = NEW.order_id;
  RETURN NULL;
END;
$$;
