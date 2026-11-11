-- Managing orders from Admin › Pedidos:
--   · cancel an unpaid order (frees its reserved stock; PayPal will not capture
--     it, and the server expires its Stripe checkout first),
--   · delete an order that was never paid (with its attempts and stock records),
--     one by one or every abandoned one at once,
--   · archive orders out of the list (paid ones are kept: invoices, accounting),
--   · the carrier's tracking events next to the shipping state.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_status text,
  ADD COLUMN IF NOT EXISTS tracking_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tracking_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS orders_archived_idx ON public.orders (archived_at);

-- ---------------------------------------------------------------------------
-- Cancel
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_unpaid_order(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_attempt uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status = 'cancelled' THEN
    RETURN 'already';
  END IF;
  IF v_order.payment_status NOT IN ('pending_session', 'checkout_open', 'expired') OR v_order.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE' USING ERRCODE = 'P0001';
  END IF;
  -- Frees the reserved stock and closes the attempt: an open PayPal order is
  -- only captured while its attempt is open.
  FOR v_attempt IN
    SELECT id FROM public.checkout_attempts
    WHERE order_id = v_order.id AND status NOT IN ('paid', 'cancelled')
  LOOP
    PERFORM public.release_reservations(v_attempt, 'cancelled');
  END LOOP;
  UPDATE public.checkout_attempts SET status = 'cancelled'
  WHERE order_id = v_order.id AND status <> 'paid';
  UPDATE public.orders SET payment_status = 'cancelled' WHERE id = v_order.id;
  RETURN 'cancelled';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_unpaid_order(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_order(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN public.cancel_unpaid_order(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Delete (only orders that were never paid)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_unpaid_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  -- Never a paid one (invoices, accounting), nor one that moved stock for real,
  -- nor one whose payment may still arrive (cancel it first).
  IF v_order.payment_status NOT IN ('pending_session', 'expired', 'cancelled')
     OR v_order.paid_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.invoices WHERE order_id = v_order.id)
     OR EXISTS (SELECT 1 FROM public.order_refunds WHERE order_id = v_order.id)
     OR EXISTS (SELECT 1 FROM public.stock_movements
                WHERE order_id = v_order.id AND reason NOT IN ('reservation', 'release'))
     OR EXISTS (SELECT 1 FROM public.stock_reservations r
                JOIN public.checkout_attempts a ON a.id = r.checkout_attempt_id
                WHERE a.order_id = v_order.id AND r.status = 'consumed') THEN
    RAISE EXCEPTION 'ORDER_NOT_DELETABLE' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_reservations r
             JOIN public.checkout_attempts a ON a.id = r.checkout_attempt_id
             WHERE a.order_id = v_order.id AND r.status = 'active') THEN
    PERFORM public.cancel_unpaid_order(v_order.id);
  END IF;

  DELETE FROM public.stock_movements
  WHERE order_id = v_order.id
     OR reservation_id IN (
       SELECT r.id FROM public.stock_reservations r
       JOIN public.checkout_attempts a ON a.id = r.checkout_attempt_id
       WHERE a.order_id = v_order.id
     );
  DELETE FROM public.stock_reservations
  WHERE checkout_attempt_id IN (SELECT id FROM public.checkout_attempts WHERE order_id = v_order.id);
  DELETE FROM public.checkout_attempts WHERE order_id = v_order.id;
  DELETE FROM public.order_items WHERE order_id = v_order.id;
  DELETE FROM public.notification_outbox WHERE payload->>'order_id' = v_order.id::text;
  DELETE FROM public.orders WHERE id = v_order.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unpaid_order(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM public.delete_unpaid_order(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_order(uuid) TO authenticated;

-- Every abandoned order at once: never paid, closed more than a day ago, or
-- left open for over two days (no Stripe or PayPal checkout lasts that long).
CREATE OR REPLACE FUNCTION public.admin_delete_abandoned_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  FOR v_id IN
    SELECT o.id FROM public.orders o
    WHERE o.paid_at IS NULL
      AND (
        (o.payment_status IN ('pending_session', 'expired', 'cancelled') AND o.created_at < now() - interval '1 day')
        OR (o.payment_status = 'checkout_open' AND o.created_at < now() - interval '2 days')
      )
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.stock_movements m
                      WHERE m.order_id = o.id AND m.reason NOT IN ('reservation', 'release'))
    ORDER BY o.created_at
  LOOP
    IF (SELECT payment_status FROM public.orders WHERE id = v_id) = 'checkout_open' THEN
      PERFORM public.cancel_unpaid_order(v_id);
    END IF;
    PERFORM public.delete_unpaid_order(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_abandoned_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_abandoned_orders() TO authenticated;

-- ---------------------------------------------------------------------------
-- Archive
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_order_archived(p_order_id uuid, p_archived boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.orders
  SET archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
  WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_order_archived(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_order_archived(uuid, boolean) TO authenticated;
