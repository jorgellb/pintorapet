-- Stock held by a checkout always comes back, nobody can hold the shop's
-- stock in a loop, and personal data is kept only as long as the privacy page
-- says.
--
--   * lapsed_attempts lists checkouts whose time is up, for the server to
--     free one at a time: PayPal ones (as before), and now Stripe ones that
--     never opened a session or whose session ended with no "expired" webhook
--     (those once Stripe confirms it). A unique piece no longer shows sold out
--     for ever after a Stripe hiccup.
--   * release_owner_open_orders: a cart has one checkout open at a time (the
--     new one replaces the older ones, as with coupons already), released
--     before the new one reserves.
--   * rate_limit_hit: a fixed-window counter per IP for the anonymous routes
--     that write (checkout, prices, page views).
--   * purge_expired_data, run daily by the cron: abandoned quotes after 30
--     days, sent email contents after 90, contact messages after 2 years,
--     page views after 13 months, expired sign-in tokens and sessions.
--   * release_reservations now locks the order before the checkout, the order
--     apply_payment uses, so the two cannot deadlock.

-- ---------------------------------------------------------------------------
-- Lapsed checkouts
-- ---------------------------------------------------------------------------

-- Checkouts whose time is up, for the server to free one at a time
-- (lib/server/commerce/lapsed.ts, each in its own transaction):
--   * PayPal ones past their expiry (as release_expired_paypal_attempts);
--   * Stripe ones that never opened a session (the reservation is 35 minutes);
--   * Stripe ones whose session ended an hour ago with no "expired" webhook.
--     ask_stripe: these are freed only once Stripe says the session expired,
--     because a paid one's webhook may just be late, or its money may still be
--     on its way (a slow payment method).
CREATE OR REPLACE FUNCTION public.lapsed_attempts(p_limit integer DEFAULT 50)
RETURNS TABLE (attempt_id uuid, provider text, stripe_session_id text, ask_stripe boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.id, a.payment_provider, a.stripe_session_id,
         (a.payment_provider = 'stripe' AND a.status = 'session_open')
  FROM public.checkout_attempts a
  WHERE a.status IN ('creating_session', 'session_open')
    AND (
      (a.payment_provider = 'paypal' AND a.session_expires_at < now())
      OR (a.payment_provider = 'stripe' AND a.status = 'creating_session' AND a.created_at < now() - interval '40 minutes')
      OR (a.payment_provider = 'stripe' AND a.status = 'session_open' AND a.session_expires_at < now() - interval '1 hour')
    )
  ORDER BY a.created_at
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- ---------------------------------------------------------------------------
-- One open checkout per cart
-- ---------------------------------------------------------------------------

-- Before a cart opens a checkout, its other shop orders still waiting for
-- payment are released (their pieces back on sale, so a unique piece the same
-- person reserved a minute ago can be reserved again). p_keep_attempt is the
-- checkout being opened (a retry of it keeps its order). Returns the released
-- orders with their Stripe session, for the app to expire it. Commission
-- payments are left alone.
CREATE OR REPLACE FUNCTION public.release_owner_open_orders(p_cart_owner_hash text, p_keep_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old record;
  v_attempt uuid;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(p_cart_owner_hash, '') = '' THEN
    RETURN v_out;
  END IF;

  FOR v_old IN
    SELECT o.id,
           coalesce(o.stripe_session_id,
                    (SELECT a.stripe_session_id FROM public.checkout_attempts a
                     WHERE a.order_id = o.id AND a.stripe_session_id IS NOT NULL
                     ORDER BY a.created_at DESC LIMIT 1)) AS stripe_session_id
    FROM public.orders o
    WHERE o.commission_request_id IS NULL
      AND o.payment_status IN ('pending_session', 'checkout_open')
      AND o.paid_at IS NULL
      AND EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.order_id = o.id AND a.cart_owner_hash = p_cart_owner_hash)
      AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.order_id = o.id AND a.id = p_keep_attempt)
    ORDER BY o.id
  LOOP
    BEGIN
      FOR v_attempt IN
        SELECT a.id FROM public.checkout_attempts a
        WHERE a.order_id = v_old.id AND a.status NOT IN ('paid', 'cancelled', 'expired', 'review')
      LOOP
        PERFORM public.release_reservations(v_attempt, 'superseded');
      END LOOP;
      -- Paid meanwhile, it keeps its status.
      IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_old.id AND payment_status = 'expired') THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('order_id', v_old.id, 'stripe_session_id', v_old.stripe_session_id));
      END IF;
    EXCEPTION WHEN raise_exception THEN
      NULL;
    END;
  END LOOP;
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- release_reservations: the order first, then the checkout (as apply_payment)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_reservations(
  p_attempt_id uuid,
  p_reason text DEFAULT 'expired'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order_id uuid;
  v_res public.stock_reservations%ROWTYPE;
  v_released integer := 0;
  v_new_status public.checkout_attempt_status;
  v_order_status public.order_payment_status;
BEGIN
  SELECT order_id INTO v_order_id FROM public.checkout_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.orders WHERE id = v_order_id FOR UPDATE;

  SELECT * INTO v_attempt
  FROM public.checkout_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  -- Already terminal / paid — do not release
  IF v_attempt.status IN ('paid', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'status', v_attempt.status,
      'released', 0,
      'replay', true
    );
  END IF;

  -- Guard: if order already paid, never release
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = v_attempt.order_id AND o.payment_status = 'paid'
  ) THEN
    RETURN jsonb_build_object(
      'attempt_id', p_attempt_id,
      'status', 'paid',
      'released', 0,
      'replay', true
    );
  END IF;

  FOR v_res IN
    SELECT * FROM public.stock_reservations
    WHERE checkout_attempt_id = p_attempt_id AND status = 'active'
    ORDER BY product_id
    FOR UPDATE
  LOOP
    UPDATE public.inventory
    SET
      stock_reserved = stock_reserved - v_res.quantity,
      version = version + 1
    WHERE product_id = v_res.product_id
      AND stock_reserved >= v_res.quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RELEASE_INVARIANT_BROKEN' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.stock_reservations
    SET status = 'released', released_at = now()
    WHERE id = v_res.id AND status = 'active';

    -- Informational ledger row (on_hand unchanged; reserved already decreased)
    INSERT INTO public.stock_movements (
      product_id,
      quantity_delta,
      reason,
      order_id,
      reservation_id,
      dedupe_key,
      note
    ) VALUES (
      v_res.product_id,
      v_res.quantity,
      'release',
      v_attempt.order_id,
      v_res.id,
      'release:' || p_attempt_id::text || ':' || v_res.id::text,
      p_reason
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_released := v_released + 1;
  END LOOP;

  IF p_reason = 'cancelled' THEN
    v_new_status := 'cancelled';
    v_order_status := 'cancelled';
  ELSE
    v_new_status := 'expired';
    v_order_status := 'expired';
  END IF;

  UPDATE public.checkout_attempts
  SET status = v_new_status
  WHERE id = p_attempt_id
    AND status NOT IN ('paid', 'cancelled', 'expired');

  UPDATE public.orders
  SET payment_status = v_order_status
  WHERE id = v_attempt.order_id
    AND payment_status NOT IN ('paid', 'refunded', 'partially_refunded', 'review');

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', v_new_status,
    'released', v_released,
    'replay', v_released = 0
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Rate limits for anonymous routes that write
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket text NOT NULL,
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key_hash, window_start)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;

-- Counts one hit for this key in the current window; true while it is within p_limit.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_window integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_start timestamptz := to_timestamp(floor(extract(epoch FROM now()) / v_window) * v_window);
  v_hits integer;
BEGIN
  INSERT INTO public.rate_limits (bucket, key_hash, window_start, hits)
  VALUES (p_bucket, p_key_hash, v_start, 1)
  ON CONFLICT (bucket, key_hash, window_start) DO UPDATE SET hits = public.rate_limits.hits + 1
  RETURNING hits INTO v_hits;
  RETURN v_hits <= p_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Retention (see the privacy page)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_quotes integer;
  v_outbox integer;
  v_messages integer;
  v_views integer;
  v_limits integer;
  v_tokens integer;
  v_sessions integer;
BEGIN
  -- Quotes nobody went on to pay (with their NIF and address, when given).
  DELETE FROM public.checkout_quotes q
  WHERE q.created_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.quote_id = q.id);
  GET DIAGNOSTICS v_quotes = ROW_COUNT;

  -- What a sent (or given up) email said, and to whom; its row stays so it is never sent again.
  UPDATE public.notification_outbox
  SET payload = '{}'::jsonb, recipient = CASE WHEN recipient = 'admin' THEN 'admin' ELSE '' END
  WHERE status IN ('sent', 'failed', 'cancelled')
    AND coalesce(sent_at, updated_at) < now() - interval '90 days'
    AND (payload <> '{}'::jsonb OR recipient NOT IN ('', 'admin'));
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  DELETE FROM public.contact_messages WHERE updated_at < now() - interval '2 years';
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM public.page_views WHERE viewed_at < now() - interval '13 months';
  GET DIAGNOSTICS v_views = ROW_COUNT;

  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS v_limits = ROW_COUNT;
  DELETE FROM public.antibot_events WHERE created_at < now() - interval '30 days';

  DELETE FROM auth.verification WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_tokens = ROW_COUNT;
  DELETE FROM auth.session WHERE expires_at < now();
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  RETURN jsonb_build_object('quotes', v_quotes, 'emails', v_outbox, 'messages', v_messages, 'page_views', v_views,
                            'rate_limits', v_limits, 'tokens', v_tokens, 'sessions', v_sessions);
END;
$$;

-- Commission requests 2 years after their last activity, with no order or
-- review: the app deletes their photos (Cloudinary), then forget_commission.
CREATE OR REPLACE FUNCTION public.stale_commission_requests()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r.id FROM public.commission_requests r
  WHERE r.updated_at < now() - interval '2 years'
    AND r.paid_order_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.commission_request_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.reviews v WHERE v.commission_request_id = r.id)
  ORDER BY r.updated_at
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.forget_commission(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stale_commission_requests() s WHERE s = p_id) THEN
    RAISE EXCEPTION 'COMMISSION_NOT_STALE' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_files WHERE commission_request_id = p_id AND storage_public_id IS NOT NULL) THEN
    RAISE EXCEPTION 'COMMISSION_PHOTOS_LEFT' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.checkout_quotes q
  WHERE q.commission_request_id = p_id AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.quote_id = q.id);
  DELETE FROM public.commission_files WHERE commission_request_id = p_id;
  DELETE FROM public.commission_requests WHERE id = p_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: all of this is for the server only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.lapsed_attempts(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_owner_open_orders(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_reservations(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stale_commission_requests() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forget_commission(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lapsed_attempts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_owner_open_orders(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reservations(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.stale_commission_requests() TO service_role;
GRANT EXECUTE ON FUNCTION public.forget_commission(uuid) TO service_role;
