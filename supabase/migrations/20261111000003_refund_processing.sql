-- Refunds Stripe or PayPal are still processing are not done yet: they stay
-- "pending" (with the provider's id) until the provider confirms them (webhook,
-- or "Comprobar ahora"). A refund that fails while processing becomes failed;
-- one that fails after it was done (Stripe allows it) is flagged for Meili,
-- as its rectifying invoice cannot be undone.

-- Our refund is with Stripe/PayPal, processing: remember their id.
CREATE OR REPLACE FUNCTION public.admin_mark_refund_processing(p_refund_id uuid, p_provider_refund_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_provider_refund_id, '')) = '' THEN
    RAISE EXCEPTION 'REFUND_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE public.order_refunds
  SET provider_refund_id = p_provider_refund_id, error = NULL
  WHERE id = p_refund_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_refund_processing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_refund_processing(uuid, text) TO authenticated;

-- Stripe/PayPal says a refund failed. Returns failed · review · unknown.
CREATE OR REPLACE FUNCTION public.provider_refund_failed(p_provider_refund_id text, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_refund public.order_refunds%ROWTYPE;
BEGIN
  SELECT * INTO v_refund FROM public.order_refunds WHERE provider_refund_id = p_provider_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unknown';
  END IF;
  IF v_refund.status = 'pending' THEN
    UPDATE public.order_refunds
    SET status = 'failed', error = left(coalesce(nullif(btrim(p_reason), ''), 'Rechazada'), 500), completed_at = now()
    WHERE id = v_refund.id;
    RETURN 'failed';
  END IF;
  IF v_refund.status = 'succeeded' THEN
    UPDATE public.order_refunds
    SET error = left('Stripe/PayPal avisa de que esta devolución falló después de hacerse ('
                     || coalesce(nullif(btrim(p_reason), ''), 'sin motivo') || '). Revisa si la clienta recibió el dinero.', 500)
    WHERE id = v_refund.id;
    RETURN 'review';
  END IF;
  RETURN 'unknown';
END;
$$;

REVOKE ALL ON FUNCTION public.provider_refund_failed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_refund_failed(text, text) TO service_role;
