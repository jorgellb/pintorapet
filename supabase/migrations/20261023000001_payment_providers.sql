-- Payment providers connected from the admin dashboard (Stripe, PayPal).
-- Non-secret settings live in payment_providers; keys live in Supabase Vault.

CREATE TABLE public.payment_providers (
  provider text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  mode text NOT NULL,
  account_id text,
  account_label text,
  key_hint text,
  public_key text,
  webhook_id text,
  webhook_url text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_providers_provider_known CHECK (provider IN ('stripe', 'paypal')),
  CONSTRAINT payment_providers_mode_known CHECK (mode IN ('test', 'live'))
);

CREATE TRIGGER payment_providers_set_updated_at
  BEFORE UPDATE ON public.payment_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_providers_admin_select
  ON public.payment_providers FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY payment_providers_admin_update
  ON public.payment_providers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.payment_providers TO authenticated;
GRANT UPDATE (enabled) ON public.payment_providers TO authenticated;
GRANT SELECT ON public.payment_providers TO service_role;

-- ---------------------------------------------------------------------------
-- Connect / disconnect (admin). Secrets go to Vault as payments.<provider>.<name>.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_connect_payment_provider(
  p_provider text,
  p_settings jsonb,
  p_secrets jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text;
  v_value text;
  v_name text;
  v_existing uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.payment_providers AS pp (
    provider, enabled, mode, account_id, account_label, key_hint, public_key,
    webhook_id, webhook_url, connected_at
  ) VALUES (
    p_provider,
    coalesce((p_settings->>'enabled')::boolean, true),
    p_settings->>'mode',
    p_settings->>'accountId',
    p_settings->>'accountLabel',
    p_settings->>'keyHint',
    p_settings->>'publicKey',
    p_settings->>'webhookId',
    p_settings->>'webhookUrl',
    now()
  )
  ON CONFLICT (provider) DO UPDATE SET
    mode = EXCLUDED.mode,
    account_id = EXCLUDED.account_id,
    account_label = EXCLUDED.account_label,
    key_hint = coalesce(EXCLUDED.key_hint, pp.key_hint),
    public_key = coalesce(EXCLUDED.public_key, pp.public_key),
    webhook_id = EXCLUDED.webhook_id,
    webhook_url = EXCLUDED.webhook_url,
    connected_at = CASE WHEN p_settings ? 'keyHint' THEN now() ELSE pp.connected_at END;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(coalesce(p_secrets, '{}'::jsonb))
  LOOP
    v_name := 'payments.' || p_provider || '.' || v_key;
    SELECT id INTO v_existing FROM vault.secrets WHERE name = v_name;
    IF v_value IS NULL OR v_value = '' THEN
      DELETE FROM vault.secrets WHERE name = v_name;
    ELSIF v_existing IS NULL THEN
      PERFORM vault.create_secret(v_value, v_name);
    ELSE
      PERFORM vault.update_secret(v_existing, v_value);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_disconnect_payment_provider(p_provider text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM vault.secrets WHERE name LIKE 'payments.' || p_provider || '.%';
  DELETE FROM public.payment_providers WHERE provider = p_provider;
END;
$$;

-- Server only: decrypted keys for one provider.
CREATE OR REPLACE FUNCTION public.payment_provider_secrets(p_provider text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    jsonb_object_agg(substr(name, length('payments.' || p_provider || '.') + 1), decrypted_secret),
    '{}'::jsonb
  )
  FROM vault.decrypted_secrets
  WHERE name LIKE 'payments.' || p_provider || '.%';
$$;

REVOKE ALL ON FUNCTION public.admin_connect_payment_provider(text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_disconnect_payment_provider(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_provider_secrets(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_connect_payment_provider(text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_disconnect_payment_provider(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_provider_secrets(text) TO service_role;

-- ---------------------------------------------------------------------------
-- PayPal on orders and checkout attempts
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN paypal_order_id text,
  ADD COLUMN paypal_capture_id text,
  ADD CONSTRAINT orders_payment_provider_known CHECK (payment_provider IN ('stripe', 'paypal')),
  ADD CONSTRAINT orders_paypal_order_id_unique UNIQUE (paypal_order_id),
  ADD CONSTRAINT orders_paypal_capture_id_unique UNIQUE (paypal_capture_id);

ALTER TABLE public.checkout_attempts
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN paypal_order_id text,
  ADD COLUMN paypal_payload jsonb,
  ADD CONSTRAINT checkout_attempts_payment_provider_known CHECK (payment_provider IN ('stripe', 'paypal')),
  ADD CONSTRAINT checkout_attempts_paypal_order_id_unique UNIQUE (paypal_order_id);

CREATE OR REPLACE FUNCTION public.attach_paypal_order(
  p_attempt_id uuid,
  p_paypal_order_id text,
  p_payload jsonb
)
RETURNS public.checkout_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.checkout_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_attempt.paypal_order_id IS NOT NULL THEN
    IF v_attempt.paypal_order_id = p_paypal_order_id THEN
      RETURN v_attempt;
    END IF;
    RAISE EXCEPTION 'SESSION_ALREADY_ATTACHED' USING ERRCODE = 'P0001';
  END IF;

  IF v_attempt.status NOT IN ('creating_session', 'session_open') OR v_attempt.stripe_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_ATTACHABLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.checkout_attempts
  SET
    payment_provider = 'paypal',
    paypal_order_id = p_paypal_order_id,
    paypal_payload = p_payload,
    status = 'session_open'
  WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;

  UPDATE public.orders
  SET
    payment_provider = 'paypal',
    payment_status = 'checkout_open',
    paypal_order_id = p_paypal_order_id
  WHERE id = v_attempt.order_id
    AND payment_status IN ('pending_session', 'checkout_open');

  RETURN v_attempt;
END;
$$;

-- Reuses apply_payment (reservations, stock, outbox) keyed by the PayPal capture.
CREATE OR REPLACE FUNCTION public.apply_paypal_payment(
  p_order_id uuid,
  p_paypal_order_id text,
  p_capture_id text,
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
  v_event_id text := 'paypal:' || p_capture_id;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = p_order_id AND paypal_order_id = p_paypal_order_id
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.apply_payment(
    p_order_id, v_event_id, NULL, NULL, p_amount_total_cents, p_currency,
    p_customer_email, p_customer_name, p_shipping_address
  );

  UPDATE public.orders
  SET paypal_capture_id = coalesce(paypal_capture_id, p_capture_id)
  WHERE id = p_order_id;

  UPDATE public.stripe_events
  SET event_type = 'paypal.capture.completed', related_object_id = p_paypal_order_id
  WHERE event_id = v_event_id;

  RETURN v_result;
END;
$$;

-- PayPal has no expiry webhook: release abandoned PayPal attempts once their reservation lapses.
CREATE OR REPLACE FUNCTION public.release_expired_paypal_attempts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.checkout_attempts
    WHERE payment_provider = 'paypal'
      AND status IN ('creating_session', 'session_open')
      AND session_expires_at < now()
    ORDER BY session_expires_at
    LIMIT 50
  LOOP
    PERFORM public.release_reservations(v_id, 'paypal_expired');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_paypal_order(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paypal_payment(uuid, text, text, integer, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_expired_paypal_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_paypal_order(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paypal_payment(uuid, text, text, integer, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_paypal_attempts() TO service_role;
