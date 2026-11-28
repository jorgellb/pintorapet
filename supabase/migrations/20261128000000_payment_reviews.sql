-- Payments that do not fit their order are kept, with their reason, for Meili to settle.
--
-- Before this, apply_payment marked such an order "review" and then raised,
-- which rolled the mark back: a charge whose amount did not match, or whose
-- stock could not be taken, left no trace, and "delete abandoned" could later
-- remove the order. Now:
--   * every such payment is saved on the order (status review, why, the
--     payment ids, paid_at) and Meili gets an email;
--   * a payment delivered outside the region it was quoted for (Canarias vs
--     the Peninsula, say: VAT and shipping differ) goes to review instead of
--     being invoiced with the quoted VAT;
--   * a second, different payment for an order already paid or refunded is
--     recorded and reported instead of being taken for a retry;
--   * Admin can confirm a reviewed payment (the order is then paid, with the
--     VAT of the address it is delivered to) or cancel it (its pieces go back
--     on sale; the money is refunded from Stripe or PayPal).
-- And around invoices:
--   * an order delivered outside its quoted region is never invoiced until
--     Meili confirms it;
--   * the Verifactu chain refuses a record that does not follow the last one
--     or is older than it (a clock that went back), never forks, and every
--     invoice's base plus VAT is its total;
--   * an AEAT-accepted invoice cannot go back to another status.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS review_reason text;

COMMENT ON COLUMN public.orders.review_reason IS
  'Why a payment is waiting for Meili (payment_status review): AMOUNT_MISMATCH, STOCK_CONSUME_FAILED, PAID_WITHOUT_RESERVATION, DESTINATION_CHANGED, COMMISSION_ALREADY_PAID, COMMISSION_QUOTE_CHANGED, PAID_AFTER_CANCEL.';

-- ---------------------------------------------------------------------------
-- Helpers (service only)
-- ---------------------------------------------------------------------------

-- Tells Meili, once per order and reason (and per payment, for one that
-- arrives on top of the order's own: p_payment names it).
CREATE OR REPLACE FUNCTION public.payment_review_alert(p_order_id uuid, p_reason text, p_payment text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at)
  SELECT 'payment_review_admin:' || o.id || ':' || p_reason || coalesce(':' || p_payment, ''), 'admin', o.locale,
         'payment_review_admin',
         jsonb_build_object('order_id', o.id, 'reference', o.reference, 'reason', p_reason, 'payment', p_payment),
         'pending', now()
  FROM public.orders o
  WHERE o.id = p_order_id
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

-- Saves a payment that needs Meili on its order, and closes its event.
CREATE OR REPLACE FUNCTION public.mark_payment_review(
  p_order_id uuid,
  p_reason text,
  p_event_id text,
  p_session_id text,
  p_payment_intent_id text,
  p_customer_email text,
  p_customer_name text,
  p_shipping_address jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.orders
  SET payment_status = 'review',
      review_reason = p_reason,
      stripe_session_id = coalesce(p_session_id, stripe_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
      customer_email = coalesce(p_customer_email, customer_email),
      customer_name = coalesce(p_customer_name, customer_name),
      shipping_address = coalesce(p_shipping_address, shipping_address),
      paid_at = coalesce(paid_at, now())
  WHERE id = p_order_id;

  UPDATE public.stripe_events
  SET status = 'processed', processed_at = now(), last_error = p_reason,
      payload_summary = payload_summary || jsonb_build_object('payment_intent_id', p_payment_intent_id)
  WHERE event_id = p_event_id;

  PERFORM public.payment_review_alert(p_order_id, p_reason);
  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'review', 'reason', p_reason, 'replay', false);
END;
$$;

-- True unless the address is known to lie outside the country or Spanish
-- region the order was quoted for (the test orders_check_destination makes).
CREATE OR REPLACE FUNCTION public.destination_fits(p_order public.orders, p_address jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_address IS NULL OR p_order.shipping_country IS NULL
    OR (
      upper(coalesce(p_address->>'country', '')) = p_order.shipping_country
      AND (upper(coalesce(p_address->>'country', '')) <> 'ES'
           OR public.es_region(coalesce(p_address->>'postal_code', '')) = public.es_region(p_order.shipping_postal_code))
    ) IS NOT FALSE;
$$;

-- ---------------------------------------------------------------------------
-- apply_payment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_payment(
  p_order_id uuid,
  p_stripe_event_id text,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
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
  v_order public.orders%ROWTYPE;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_res public.stock_reservations%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_active_count integer;
  v_paid_by uuid;
  v_request public.commission_requests%ROWTYPE;
  v_same boolean;
  v_fits boolean;
BEGIN
  IF p_currency IS DISTINCT FROM 'EUR' THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- Record event row early (unique); do not mark processed until done
  INSERT INTO public.stripe_events (event_id, event_type, related_object_id, status, payload_summary)
  VALUES (
    p_stripe_event_id,
    'checkout.session.completed',
    coalesce(p_stripe_session_id, p_order_id::text),
    'processing',
    jsonb_build_object(
      'order_id', p_order_id,
      'amount_total_cents', p_amount_total_cents,
      'session_id', p_stripe_session_id
    )
  )
  ON CONFLICT (event_id) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM public.stripe_events
    WHERE event_id = p_stripe_event_id AND status = 'processed'
  ) THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'status', coalesce((SELECT payment_status::text FROM public.orders WHERE id = p_order_id), 'paid'),
      'replay', true
    );
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- This very payment again (a retry, or a second event for one session).
  v_same := coalesce(v_order.stripe_payment_intent_id = p_stripe_payment_intent_id, false)
         OR coalesce(v_order.stripe_session_id = p_stripe_session_id, false)
         OR coalesce(p_stripe_event_id = 'paypal:' || v_order.paypal_capture_id, false);

  IF v_order.payment_status IN ('paid', 'review', 'partially_refunded', 'refunded') THEN
    IF v_same THEN
      UPDATE public.stripe_events
      SET status = 'processed', processed_at = coalesce(processed_at, now())
      WHERE event_id = p_stripe_event_id;
      RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.payment_status, 'replay', true);
    END IF;
    -- Another payment for an order already settled: the order stays as it is,
    -- the money is on record (the event, shown on the order page) and Meili
    -- is told which payment to refund from Stripe or PayPal.
    UPDATE public.stripe_events
    SET status = 'processed', processed_at = now(), last_error = 'PAID_AGAIN',
        payload_summary = payload_summary || jsonb_build_object('payment_intent_id', p_stripe_payment_intent_id)
    WHERE event_id = p_stripe_event_id;
    PERFORM public.payment_review_alert(v_order.id, 'PAID_AGAIN', coalesce(p_stripe_payment_intent_id, p_stripe_event_id));
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.payment_status, 'reason', 'PAID_AGAIN', 'replay', false);
  END IF;

  SELECT * INTO v_attempt
  FROM public.checkout_attempts
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_order.total_cents <> p_amount_total_cents THEN
    -- Its pieces stay reserved for this customer until Meili decides.
    UPDATE public.checkout_attempts SET status = 'review'
    WHERE id = v_attempt.id AND status IN ('creating_session', 'session_open');
    RETURN public.mark_payment_review(v_order.id, 'AMOUNT_MISMATCH', p_stripe_event_id, p_stripe_session_id,
      p_stripe_payment_intent_id, p_customer_email, p_customer_name, p_shipping_address);
  END IF;

  -- A commission paid already by another order (two tabs, two payments): review it, refund the second.
  IF v_order.commission_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.commission_requests
    WHERE id = v_order.commission_request_id FOR UPDATE;
    v_paid_by := v_request.paid_order_id;
    -- Paid already by another order, or quoted again since this order was made.
    IF (v_paid_by IS NOT NULL AND v_paid_by <> v_order.id)
       OR (v_paid_by IS NULL AND v_order.commission_fingerprint IS DISTINCT FROM public.commission_quote_fingerprint(v_request)) THEN
      RETURN public.mark_payment_review(v_order.id,
        CASE WHEN v_paid_by IS NOT NULL THEN 'COMMISSION_ALREADY_PAID' ELSE 'COMMISSION_QUOTE_CHANGED' END,
        p_stripe_event_id, p_stripe_session_id, p_stripe_payment_intent_id, NULL, NULL, NULL);
    END IF;
  END IF;

  -- Paid after it was cancelled (its pieces already back on sale); the amount
  -- and the commission were checked above.
  IF v_order.payment_status = 'cancelled' THEN
    RETURN public.mark_payment_review(v_order.id, 'PAID_AFTER_CANCEL', p_stripe_event_id, p_stripe_session_id,
      p_stripe_payment_intent_id, p_customer_email, p_customer_name, p_shipping_address);
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.stock_reservations
  WHERE checkout_attempt_id = v_attempt.id AND status = 'active';

  IF v_active_count = 0 AND v_order.commission_request_id IS NULL THEN
    -- Paid without usable reservation → review, do not force negative stock
    RETURN public.mark_payment_review(v_order.id, 'PAID_WITHOUT_RESERVATION', p_stripe_event_id, p_stripe_session_id,
      p_stripe_payment_intent_id, p_customer_email, p_customer_name, p_shipping_address);
  END IF;

  -- Delivered outside the quoted region: VAT or shipping may not fit. Its
  -- pieces stay reserved for this customer until Meili confirms or cancels.
  v_fits := public.destination_fits(v_order, coalesce(p_shipping_address, v_order.shipping_address));
  IF NOT v_fits THEN
    UPDATE public.checkout_attempts SET status = 'review'
    WHERE id = v_attempt.id AND status IN ('creating_session', 'session_open');
    RETURN public.mark_payment_review(v_order.id, 'DESTINATION_CHANGED', p_stripe_event_id, p_stripe_session_id,
      p_stripe_payment_intent_id, p_customer_email, p_customer_name, p_shipping_address);
  END IF;

  -- Consume reservations + decrement stock deterministically. If a piece is
  -- missing, all of it is undone (this block's savepoint) and Meili decides.
  BEGIN
    FOR v_res IN
      SELECT * FROM public.stock_reservations
      WHERE checkout_attempt_id = v_attempt.id AND status = 'active'
      ORDER BY product_id
      FOR UPDATE
    LOOP
      SELECT * INTO v_item
      FROM public.order_items
      WHERE order_id = p_order_id AND product_id = v_res.product_id
      LIMIT 1;

      -- tracked: decrement on_hand + reserved; made_to_order: reserved only
      UPDATE public.inventory
      SET
        stock_on_hand = CASE
          WHEN inventory_mode = 'tracked' THEN stock_on_hand - v_res.quantity
          ELSE stock_on_hand
        END,
        stock_reserved = stock_reserved - v_res.quantity,
        version = version + 1
      WHERE product_id = v_res.product_id
        AND stock_reserved >= v_res.quantity
        AND (
          inventory_mode <> 'tracked'
          OR stock_on_hand >= v_res.quantity
        );

      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_CONSUME_FAILED' USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.stock_reservations
      SET status = 'consumed', consumed_at = now()
      WHERE id = v_res.id AND status = 'active';

      INSERT INTO public.stock_movements (
        product_id, quantity_delta, reason, order_id, order_item_id, reservation_id, dedupe_key
      ) VALUES (
        v_res.product_id, -v_res.quantity, 'sale', p_order_id, v_item.id, v_res.id,
        'sale:' || p_order_id::text || ':' || v_item.id::text
      )
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  EXCEPTION WHEN raise_exception THEN
    UPDATE public.checkout_attempts SET status = 'review'
    WHERE id = v_attempt.id AND status IN ('creating_session', 'session_open');
    RETURN public.mark_payment_review(v_order.id, 'STOCK_CONSUME_FAILED', p_stripe_event_id, p_stripe_session_id,
      p_stripe_payment_intent_id, p_customer_email, p_customer_name, p_shipping_address);
  END;

  UPDATE public.checkout_attempts
  SET status = 'paid'
  WHERE id = v_attempt.id;

  UPDATE public.orders
  SET
    payment_status = 'paid',
    review_reason = NULL,
    stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
    customer_email = coalesce(p_customer_email, customer_email),
    customer_name = coalesce(p_customer_name, customer_name),
    shipping_address = coalesce(p_shipping_address, shipping_address),
    paid_at = now()
  WHERE id = v_order.id;

  -- Durable notifications (unique per type/order/recipient)
  INSERT INTO public.notification_outbox (
    dedupe_key, recipient, locale, template_key, payload, status, next_run_at
  ) VALUES (
    'order_paid_customer:' || v_order.id::text || ':' || coalesce(p_customer_email, 'unknown'),
    coalesce(p_customer_email, ''),
    v_order.locale,
    'order_paid_customer',
    jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference),
    'pending',
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.notification_outbox (
    dedupe_key, recipient, locale, template_key, payload, status, next_run_at
  ) VALUES (
    'order_paid_admin:' || v_order.id::text || ':admin',
    'admin',
    v_order.locale,
    'order_paid_admin',
    jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference),
    'pending',
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  UPDATE public.stripe_events
  SET status = 'processed', processed_at = now()
  WHERE event_id = p_stripe_event_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'replay', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Meili settles a reviewed payment
-- ---------------------------------------------------------------------------

-- What can be confirmed: the money matches the order. A wrong amount, a
-- commission paid twice, or a review whose reason is not known are refunded
-- instead.
CREATE OR REPLACE FUNCTION public.payment_review_confirmable(p_reason text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(p_reason IN (
    'PAID_WITHOUT_RESERVATION', 'STOCK_CONSUME_FAILED', 'DESTINATION_CHANGED', 'COMMISSION_QUOTE_CHANGED', 'PAID_AFTER_CANCEL'
  ), false);
$$;

-- Orders already in review keep the reason their payment event recorded.
UPDATE public.orders o
SET review_reason = (
  SELECT e.last_error FROM public.stripe_events e
  WHERE e.payload_summary->>'order_id' = o.id::text AND e.last_error IS NOT NULL
  ORDER BY e.created_at DESC LIMIT 1)
WHERE o.payment_status = 'review' AND o.review_reason IS NULL;

-- The VAT and the exemption note follow the address it is delivered to.
CREATE OR REPLACE FUNCTION public.order_take_delivered_destination(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.orders
  SET shipping_country = upper(shipping_address->>'country'),
      shipping_postal_code = shipping_address->>'postal_code',
      vat_regime = coalesce(public.vat_regime(upper(shipping_address->>'country'), shipping_address->>'postal_code'), vat_regime),
      shipping_destination_ok = true
  WHERE id = p_order_id AND shipping_destination_ok IS FALSE AND shipping_address IS NOT NULL;
END;
$$;

-- p_action 'confirm': the order is paid (and invoiced, with the VAT of the
-- address it goes to); its reserved pieces are taken, and any not reserved
-- any more come from the free stock. 'cancel': its reserved pieces go back on
-- sale and it stays on record as cancelled with its payment, to be refunded
-- from Stripe or PayPal. Both cope with a stock_reserved counter that is
-- already short (what makes a payment STOCK_CONSUME_FAILED).
CREATE OR REPLACE FUNCTION public.admin_resolve_payment_review(p_order_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_res public.stock_reservations%ROWTYPE;
  v_item record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('confirm', 'cancel') THEN
    RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status <> 'review' THEN
    RAISE EXCEPTION 'ORDER_NOT_IN_REVIEW' USING ERRCODE = 'P0001';
  END IF;
  IF p_action = 'confirm' AND NOT public.payment_review_confirmable(v_order.review_reason) THEN
    RAISE EXCEPTION 'REVIEW_NOT_CONFIRMABLE' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.order_take_delivered_destination(v_order.id);

  -- The order's checkouts, locked after the order (the order apply_payment uses).
  PERFORM 1 FROM public.checkout_attempts WHERE order_id = v_order.id FOR UPDATE;

  FOR v_res IN
    SELECT r.* FROM public.stock_reservations r
    JOIN public.checkout_attempts a ON a.id = r.checkout_attempt_id
    WHERE a.order_id = v_order.id AND r.status = 'active'
    ORDER BY r.product_id
    FOR UPDATE OF r
  LOOP
    IF p_action = 'cancel' THEN
      UPDATE public.inventory
      SET stock_reserved = stock_reserved - least(stock_reserved, v_res.quantity), version = version + 1
      WHERE product_id = v_res.product_id;
      UPDATE public.stock_reservations SET status = 'released', released_at = now() WHERE id = v_res.id;
      INSERT INTO public.stock_movements (product_id, quantity_delta, reason, order_id, reservation_id, dedupe_key, note)
      VALUES (v_res.product_id, v_res.quantity, 'release', v_order.id, v_res.id,
              'release:' || v_res.checkout_attempt_id || ':' || v_res.id, 'cancelled')
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSE
      UPDATE public.inventory
      SET stock_on_hand = CASE WHEN inventory_mode = 'tracked' THEN stock_on_hand - v_res.quantity ELSE stock_on_hand END,
          stock_reserved = stock_reserved - least(stock_reserved, v_res.quantity),
          version = version + 1
      WHERE product_id = v_res.product_id
        AND (inventory_mode <> 'tracked'
             OR stock_on_hand - v_res.quantity >= stock_reserved - least(stock_reserved, v_res.quantity));
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_UNAVAILABLE' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.stock_reservations SET status = 'consumed', consumed_at = now() WHERE id = v_res.id;
    END IF;
  END LOOP;

  IF p_action = 'cancel' THEN
    UPDATE public.checkout_attempts SET status = 'cancelled'
    WHERE order_id = v_order.id AND status NOT IN ('paid', 'cancelled', 'expired');
    UPDATE public.orders SET payment_status = 'cancelled' WHERE id = v_order.id;
  ELSE
    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.quantity FROM public.order_items oi
      WHERE oi.order_id = v_order.id AND oi.product_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.dedupe_key = 'sale:' || v_order.id || ':' || oi.id)
      ORDER BY oi.product_id
    LOOP
      -- Not taken through a reservation just above: from the free stock.
      IF NOT EXISTS (
        SELECT 1 FROM public.stock_reservations r
        JOIN public.checkout_attempts a ON a.id = r.checkout_attempt_id
        WHERE a.order_id = v_order.id AND r.product_id = v_item.product_id AND r.status = 'consumed'
      ) THEN
        UPDATE public.inventory
        SET stock_on_hand = CASE WHEN inventory_mode = 'tracked' THEN stock_on_hand - v_item.quantity ELSE stock_on_hand END,
            version = version + 1
        WHERE product_id = v_item.product_id
          AND (inventory_mode <> 'tracked' OR stock_on_hand - stock_reserved >= v_item.quantity);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'STOCK_UNAVAILABLE' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      INSERT INTO public.stock_movements (product_id, quantity_delta, reason, order_id, order_item_id, dedupe_key, note)
      VALUES (v_item.product_id, -v_item.quantity, 'sale', v_order.id, v_item.id,
              'sale:' || v_order.id || ':' || v_item.id, 'Pago revisado')
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;

    UPDATE public.checkout_attempts SET status = 'paid'
    WHERE order_id = v_order.id AND status IN ('creating_session', 'session_open', 'review');
    -- Paid: the invoice is issued by the orders_issue_invoice trigger.
    UPDATE public.orders SET payment_status = 'paid', review_reason = NULL WHERE id = v_order.id;

    IF nullif(btrim(coalesce(v_order.customer_email, '')), '') IS NOT NULL THEN
      INSERT INTO public.notification_outbox (dedupe_key, recipient, locale, template_key, payload, status, next_run_at)
      VALUES ('order_paid_customer:' || v_order.id || ':' || v_order.customer_email, v_order.customer_email, v_order.locale,
              'order_paid_customer', jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference), 'pending', now())
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.admin_audit_log (actor_user_id, operation, entity_type, entity_id, change)
  VALUES (auth.uid(), 'resolve_payment_review', 'order', v_order.id::text,
          jsonb_build_object('action', p_action, 'reason', v_order.review_reason));

  RETURN jsonb_build_object('order_id', v_order.id, 'status', CASE WHEN p_action = 'confirm' THEN 'paid' ELSE 'cancelled' END);
END;
$$;

-- A paid order delivered outside its quoted region that never went through
-- review (paid by transfer or Bizum, say) cannot be invoiced as it is: Meili
-- takes the delivery address for it, and its invoice is issued with that VAT.
CREATE OR REPLACE FUNCTION public.admin_accept_destination(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_invoice uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'partially_refunded', 'refunded') OR v_order.shipping_destination_ok IS NOT FALSE THEN
    RAISE EXCEPTION 'DESTINATION_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;
  IF (public.current_invoice(v_order.id)).id IS NOT NULL THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.order_take_delivered_destination(v_order.id);
  INSERT INTO public.admin_audit_log (actor_user_id, operation, entity_type, entity_id, change)
  VALUES (auth.uid(), 'accept_destination', 'order', v_order.id::text,
          jsonb_build_object('country', v_order.shipping_address->>'country', 'postal_code', v_order.shipping_address->>'postal_code'));
  -- Without the tax data it waits for "Emitir facturas pendientes", like any other.
  BEGIN
    v_invoice := public.issue_invoice(v_order.id);
  EXCEPTION WHEN raise_exception THEN
    RAISE LOG 'issue_invoice %: %', v_order.id, SQLERRM;
  END;
  RETURN jsonb_build_object('order_id', v_order.id, 'invoice_id', v_invoice);
END;
$$;

-- ---------------------------------------------------------------------------
-- "Delete abandoned" never touches an order with a payment on record
-- ---------------------------------------------------------------------------

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
      AND o.stripe_payment_intent_id IS NULL
      AND o.paypal_capture_id IS NULL
      AND (
        (o.payment_status IN ('pending_session', 'expired', 'cancelled') AND o.created_at < now() - interval '1 day')
        OR (o.payment_status = 'checkout_open' AND o.created_at < now() - interval '2 days')
      )
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.stock_movements m
                      WHERE m.order_id = o.id AND m.reason NOT IN ('reservation', 'release'))
      -- Any payment event for it (even one still waiting for the money) means it may have moved.
      AND NOT EXISTS (SELECT 1 FROM public.stripe_events e WHERE e.payload_summary->>'order_id' = o.id::text)
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

-- ---------------------------------------------------------------------------
-- Pending invoices: one that cannot be issued no longer stops the others
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
      AND o.shipping_destination_ok IS NOT FALSE
      AND (public.current_invoice(o.id)).id IS NULL
    ORDER BY o.paid_at, o.id
  LOOP
    BEGIN
      PERFORM public.issue_invoice(v_id);
      v_count := v_count + 1;
    EXCEPTION WHEN raise_exception THEN
      RAISE LOG 'issue_invoice %: %', v_id, SQLERRM;
    END;
  END LOOP;
  FOR v_id IN
    SELECT r.id FROM public.order_refunds r
    WHERE r.status = 'succeeded' AND r.invoice_id IS NULL
    ORDER BY r.completed_at, r.id
  LOOP
    BEGIN
      PERFORM public.issue_rectifying_invoice(v_id);
      v_count := v_count + 1;
    EXCEPTION WHEN raise_exception THEN
      RAISE LOG 'issue_rectifying_invoice %: %', v_id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoices_check_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_last public.invoices%ROWTYPE;
BEGIN
  -- Delivered outside the quoted region: the VAT may be wrong until Meili confirms it.
  IF NEW.rectifies_invoice_id IS NULL
     AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = NEW.order_id AND o.shipping_destination_ok IS FALSE) THEN
    RAISE EXCEPTION 'INVOICE_DESTINATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- Verifactu: each record chains to the last one, and comes after it.
  SELECT * INTO v_last FROM public.invoices ORDER BY record_generated_at DESC, id DESC LIMIT 1;
  IF FOUND THEN
    IF NEW.prev_hash IS DISTINCT FROM v_last.hash THEN
      RAISE EXCEPTION 'INVOICE_CHAIN_BROKEN' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.record_generated_at <= v_last.record_generated_at THEN
      RAISE EXCEPTION 'INVOICE_CLOCK_BEHIND' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.prev_hash IS NOT NULL THEN
    RAISE EXCEPTION 'INVOICE_CHAIN_BROKEN' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_check_insert ON public.invoices;
CREATE TRIGGER invoices_check_insert
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_check_insert();

-- One first record, and no two records after the same one.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_successor ON public.invoices (coalesce(prev_hash, ''));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_amounts_add_up;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_amounts_add_up CHECK (base_cents + vat_cents = total_cents);

CREATE OR REPLACE FUNCTION public.invoices_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF to_jsonb(NEW) - 'aeat_status' - 'aeat_response'
     IS DISTINCT FROM to_jsonb(OLD) - 'aeat_status' - 'aeat_response' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  -- What the AEAT accepted stays accepted.
  IF OLD.aeat_status = 'accepted' AND NEW.aeat_status <> 'accepted' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- VAT regimes are one of the two the code knows (a quote has none until it has a destination).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_vat_regime_known;
ALTER TABLE public.orders ADD CONSTRAINT orders_vat_regime_known CHECK (vat_regime IS NULL OR vat_regime IN ('es_vat', 'no_vat'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_vat_regime_known;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_vat_regime_known CHECK (vat_regime IN ('es_vat', 'no_vat'));
ALTER TABLE public.checkout_quotes DROP CONSTRAINT IF EXISTS checkout_quotes_vat_regime_known;
ALTER TABLE public.checkout_quotes ADD CONSTRAINT checkout_quotes_vat_regime_known CHECK (vat_regime IS NULL OR vat_regime IN ('es_vat', 'no_vat'));

-- ---------------------------------------------------------------------------
-- Privileges of what this file adds
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.payment_review_alert(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_take_delivered_destination(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_accept_destination(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_accept_destination(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_payment_review(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoices_check_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_resolve_payment_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_payment_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_review_alert(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.order_take_delivered_destination(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_review(uuid, text, text, text, text, text, text, jsonb) TO service_role;
