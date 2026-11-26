-- Customers without an account (guests): their data lives in their orders.
-- Admin › Clientes can edit a guest's contact on every order, and anonymize
-- the personal data of a guest, or of an account about to be deleted, while
-- the orders and the issued invoices stay (invoices are never touched).
--
-- A guest is the orders with customer_id null that share lower(btrim(email)).
-- Its key is the sha256 hex of that value, so the email is never in a URL.
-- Every function is for the service role, called from server routes behind
-- requireAdmin(); none is reachable by anon or authenticated.

-- ——— The key ———
CREATE OR REPLACE FUNCTION public.guest_key(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(digest(lower(btrim(p_email)), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.guest_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_key(text) TO service_role;

-- ——— The record ———
-- Name and phone come from the latest order. The order list leaves out
-- checkouts that never finished, as admin_customer does; spent counts the
-- statuses that count as a purchase (order_counts_as_purchase).
CREATE OR REPLACE FUNCTION public.admin_guest_customer(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_latest public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_latest
  FROM public.orders o
  WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'key', v_key,
    'email', lower(btrim(v_latest.customer_email)),
    'full_name', coalesce(v_latest.customer_name, ''),
    'phone', coalesce(v_latest.shipping_address->>'phone', ''),
    'orders', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'reference', o.reference,
        'created_at', o.created_at,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status,
        'total_cents', o.total_cents
      ) ORDER BY o.created_at DESC, o.id DESC), '[]'::jsonb)
      FROM public.orders o
      WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key
        AND o.payment_status NOT IN ('pending_session', 'checkout_open')
    ),
    'spent_cents', (
      SELECT coalesce(sum(o.total_cents), 0)::bigint
      FROM public.orders o
      WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key
        AND public.order_counts_as_purchase(o.payment_status)
    ),
    'contact_messages', (SELECT count(*)::int FROM public.contact_messages m WHERE public.guest_key(m.contact_email) = v_key),
    'commission_requests', (SELECT count(*)::int FROM public.commission_requests r WHERE public.guest_key(r.contact_email) = v_key)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_guest_customer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_guest_customer(text) TO service_role;

-- ——— Editing the contact ———
-- On every guest order of the key: name, email, shipping_address.phone, and
-- shipping_address.name where it was the customer's own name (a gift's
-- recipient keeps theirs). The address itself is not edited here, and issued
-- invoices keep the data they were issued with.
CREATE OR REPLACE FUNCTION public.admin_guest_update(p_key text, p_full_name text, p_email text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_new_key text;
  v_merged boolean := false;
  v_count integer;
  v_skipped integer := 0;
BEGIN
  IF char_length(v_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'GUEST_INVALID_NAME' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'GUEST_INVALID_EMAIL' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_phone) > 32 THEN
    RAISE EXCEPTION 'GUEST_INVALID_PHONE' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the guest's orders, in a fixed order.
  PERFORM 1
  FROM public.orders o
  WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key
  ORDER BY o.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_new_key := public.guest_key(v_email);
  IF v_new_key <> v_key THEN
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(btrim(u.email)) = v_email) THEN
      RAISE EXCEPTION 'GUEST_EMAIL_IS_ACCOUNT' USING ERRCODE = 'P0001';
    END IF;
    v_merged := EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_new_key
    );
  END IF;

  -- An order with no address has nowhere to keep a phone: say so.
  IF v_phone <> '' THEN
    SELECT count(*)::int INTO v_skipped
    FROM public.orders o
    WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key
      AND jsonb_typeof(o.shipping_address) IS DISTINCT FROM 'object';
  END IF;

  UPDATE public.orders o
  SET customer_name = v_name,
      customer_email = v_email,
      shipping_address = CASE
        WHEN jsonb_typeof(o.shipping_address) = 'object' THEN
          (CASE WHEN v_phone = '' THEN o.shipping_address - 'phone'
                ELSE o.shipping_address || jsonb_build_object('phone', v_phone) END)
          || (CASE WHEN o.shipping_address->>'name' = o.customer_name
                   THEN jsonb_build_object('name', v_name) ELSE '{}'::jsonb END)
        ELSE o.shipping_address
      END
  WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('key', v_new_key, 'merged', v_merged, 'orders', v_count, 'phone_skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_guest_update(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_guest_update(text, text, text, text) TO service_role;

-- ——— What blocks anonymizing ———
-- The references (sorted) of the given orders that must be settled first, by
-- kind:
--   due        payment still to come (processing, awaiting a transfer, under
--              review), or paid and not on its way yet (a returned or incident
--              order counts: it still needs attention);
--   unfinished a checkout that never ended (pending_session, checkout_open):
--              not listed in the guest's record, so it is deleted from Pedidos;
--   uninvoiced charged (paid, partially refunded, or refunded after paying)
--              with no invoice issued yet. The order's invoice_customer is what
--              a pending invoice is issued from, and anonymizing erases it, so
--              the invoice must exist first.
CREATE OR REPLACE FUNCTION public.guest_blocked_orders(p_order_ids uuid[], p_kind text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT coalesce(array_agg(o.reference ORDER BY o.reference), ARRAY[]::text[])
  FROM public.orders o
  WHERE o.id = ANY (p_order_ids)
    AND CASE p_kind
      WHEN 'unfinished' THEN o.payment_status IN ('pending_session', 'checkout_open')
      WHEN 'due' THEN
        o.payment_status IN ('processing', 'awaiting_transfer', 'review')
        OR (
          o.payment_status IN ('paid', 'partially_refunded')
          -- text, because 'delivered' and 'cancelled' are not (yet) values of the enum.
          AND o.fulfillment_status::text NOT IN ('shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed', 'cancelled')
        )
      WHEN 'uninvoiced' THEN
        (o.payment_status IN ('paid', 'partially_refunded') OR (o.payment_status = 'refunded' AND o.paid_at IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.guest_blocked_orders(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_blocked_orders(uuid[], text) TO service_role;

-- All of them together: the references of the orders that are not ready to be anonymized.
CREATE OR REPLACE FUNCTION public.guest_due_orders(p_order_ids uuid[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT coalesce(array_agg(DISTINCT r ORDER BY r), ARRAY[]::text[])
  FROM unnest(
    public.guest_blocked_orders(p_order_ids, 'due')
    || public.guest_blocked_orders(p_order_ids, 'unfinished')
    || public.guest_blocked_orders(p_order_ids, 'uninvoiced')
  ) r;
$$;

REVOKE ALL ON FUNCTION public.guest_due_orders(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_due_orders(uuid[]) TO service_role;

-- ——— Anonymizing ———
-- The orders stay (they are accounting records); their personal data goes.
-- invoice_customer is kept only on an order with a full invoice, which is the
-- legal record of who was invoiced. Invoices are not touched. The reviews of
-- these orders are returned, not deleted: the caller deletes them together
-- with their photos on Cloudinary.
CREATE OR REPLACE FUNCTION public.anonymize_orders(p_order_ids uuid[], p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_ids uuid[];
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_due text[];
  v_count integer;
  v_reviews jsonb;
BEGIN
  -- Lock them, in a fixed order, and look at them as they are now.
  SELECT coalesce(array_agg(x.id ORDER BY x.id), ARRAY[]::uuid[]) INTO v_ids
  FROM (
    SELECT o.id FROM public.orders o WHERE o.id = ANY (p_order_ids) ORDER BY o.id FOR UPDATE
  ) x;

  -- One reason at a time, the one to fix first; each names the references.
  v_due := public.guest_blocked_orders(v_ids, 'due');
  IF cardinality(v_due) > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_HAS_DUE_ORDERS: %', array_to_string(v_due, ', ') USING ERRCODE = 'P0001';
  END IF;
  v_due := public.guest_blocked_orders(v_ids, 'uninvoiced');
  IF cardinality(v_due) > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_HAS_UNINVOICED_ORDERS: %', array_to_string(v_due, ', ') USING ERRCODE = 'P0001';
  END IF;
  v_due := public.guest_blocked_orders(v_ids, 'unfinished');
  IF cardinality(v_due) > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_HAS_UNFINISHED_ORDERS: %', array_to_string(v_due, ', ') USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders o
  SET customer_name = 'Cliente borrado',
      customer_email = NULL,
      shipping_address = nullif(jsonb_strip_nulls(jsonb_build_object(
        'country', o.shipping_address->>'country',
        'postal_code', o.shipping_address->>'postal_code'
      )), '{}'::jsonb),
      gift_message = NULL,
      is_gift = false,
      invoice_customer = CASE
        WHEN EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id AND i.kind = 'full')
        THEN o.invoice_customer ELSE NULL END
  WHERE o.id = ANY (v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- What the payment providers sent back carries the name and email.
  UPDATE public.checkout_attempts
  SET stripe_payload = NULL, paypal_payload = NULL
  WHERE order_id = ANY (v_ids) AND (stripe_payload IS NOT NULL OR paypal_payload IS NOT NULL);

  -- The quote the checkout started from carries the invoice details typed in
  -- (tax id, name, address): kept only where the order has its full invoice.
  UPDATE public.checkout_quotes q
  SET invoice_customer = NULL
  FROM public.checkout_attempts a
  WHERE a.quote_id = q.id AND a.order_id = ANY (v_ids) AND q.invoice_customer IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = a.order_id AND i.kind = 'full');

  -- A commission paid by Bizum or a transfer has no checkout attempt: its quotes
  -- are tied to the commission request instead, and carry the same details.
  UPDATE public.checkout_quotes q
  SET invoice_customer = NULL
  FROM public.orders o
  WHERE o.id = ANY (v_ids) AND o.commission_request_id IS NOT NULL
    AND q.commission_request_id = o.commission_request_id AND q.invoice_customer IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id AND i.kind = 'full');

  -- The notice to the shop about a review (name, city, excerpt) goes before the
  -- reviews do: it is addressed to the shop and names no order, only the review.
  DELETE FROM public.notification_outbox
  WHERE template_key = 'review_admin'
    AND payload->>'review_id' IN (SELECT r.id::text FROM public.reviews r WHERE r.order_id = ANY (v_ids));

  -- Rows about these orders, whoever they went to (an email the guest used
  -- before an edit, for one), and rows sent to this email that are about no
  -- order at all. Rows about other orders stay: they may be the same email's
  -- account orders, which are not being erased.
  DELETE FROM public.notification_outbox
  WHERE payload->>'order_id' IN (SELECT x::text FROM unnest(v_ids) x)
     OR (v_email <> '' AND lower(btrim(recipient)) = v_email AND payload->>'order_id' IS NULL);

  -- Coupon uses are one per order: these orders' emails go (not the same email on an order that stays).
  UPDATE public.coupon_redemptions
  SET email = NULL, payer_email = NULL
  WHERE order_id = ANY (v_ids) AND (email IS NOT NULL OR payer_email IS NOT NULL);

  SELECT coalesce(jsonb_agg(r.id ORDER BY r.id), '[]'::jsonb) INTO v_reviews
  FROM public.reviews r WHERE r.order_id = ANY (v_ids);

  RETURN jsonb_build_object('orders', v_count, 'review_ids', v_reviews);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_orders(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_orders(uuid[], text) TO service_role;

-- The guest's orders, then anonymize them with the guest's email.
CREATE OR REPLACE FUNCTION public.admin_guest_anonymize(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_ids uuid[];
  v_email text;
BEGIN
  -- Collected under the lock, so an edit or an order in flight is waited for.
  SELECT array_agg(x.id ORDER BY x.id),
         (array_agg(lower(btrim(x.customer_email)) ORDER BY x.created_at DESC, x.id DESC))[1]
    INTO v_ids, v_email
  FROM (
    SELECT o.id, o.customer_email, o.created_at
    FROM public.orders o
    WHERE o.customer_id IS NULL AND o.customer_email IS NOT NULL AND public.guest_key(o.customer_email) = v_key
    ORDER BY o.id
    FOR UPDATE
  ) x;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'GUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.anonymize_orders(v_ids, v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_guest_anonymize(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_guest_anonymize(text) TO service_role;

-- The account's orders plus the guest orders placed with its email: read
-- before the auth user is deleted, which unlinks the first kind.
CREATE OR REPLACE FUNCTION public.admin_account_order_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT coalesce(array_agg(o.id ORDER BY o.id), ARRAY[]::uuid[])
  FROM public.orders o
  WHERE o.customer_id = p_user_id
     OR (
       o.customer_id IS NULL AND o.customer_email IS NOT NULL
       AND public.guest_key(o.customer_email) IN (SELECT public.guest_key(u.email) FROM auth.users u WHERE u.id = p_user_id)
     );
$$;

REVOKE ALL ON FUNCTION public.admin_account_order_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_order_ids(uuid) TO service_role;

-- ——— The guests' list ———
-- Same as 20261026000002 (the body was compared with production's before this
-- was written: identical), except for the guest rows: one per lower(btrim(email)),
-- as the guest record groups them, and each carries its `key`, computed here by
-- guest_key so the list's links and the record can never disagree.
CREATE OR REPLACE FUNCTION public.admin_customers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY row->>'sort_at' DESC NULLS LAST)
    FROM (
      -- Accounts
      SELECT jsonb_build_object(
        'kind', 'account',
        'id', u.id,
        'email', u.email,
        'confirmed', u.email_confirmed_at IS NOT NULL,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'full_name', coalesce(nullif(c.full_name, ''), u.raw_user_meta_data->>'full_name', ''),
        'phone', coalesce(c.phone, ''),
        'city', c.address->>'city',
        'country', c.address->>'country',
        'has_billing', c.billing IS NOT NULL,
        'is_admin', EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id AND a.is_active),
        'order_count', s.order_count,
        'spent_cents', s.spent_cents,
        'last_order_at', s.last_order_at,
        'sort_at', greatest(u.created_at, s.last_order_at)
      ) AS row
      FROM auth.users u
      LEFT JOIN public.customers c ON c.id = u.id
      LEFT JOIN LATERAL (
        SELECT count(*) AS order_count,
               coalesce(sum(o.total_cents), 0) AS spent_cents,
               max(o.created_at) AS last_order_at
        FROM public.orders o
        WHERE public.order_counts_as_purchase(o.payment_status)
          AND (o.customer_id = u.id OR lower(o.customer_email) = lower(u.email))
      ) s ON true

      UNION ALL

      -- Guests: emails that only appear on orders
      SELECT jsonb_build_object(
        'kind', 'guest',
        'id', NULL,
        'key', public.guest_key(g.email),
        'email', g.email,
        'confirmed', false,
        'created_at', g.first_order_at,
        'last_sign_in_at', NULL,
        'full_name', g.full_name,
        'phone', '',
        'city', g.city,
        'country', g.country,
        'has_billing', false,
        'is_admin', false,
        'order_count', g.order_count,
        'spent_cents', g.spent_cents,
        'last_order_at', g.last_order_at,
        'sort_at', g.last_order_at
      )
      FROM (
        SELECT lower(btrim(o.customer_email)) AS email,
               (array_agg(o.customer_name ORDER BY o.created_at DESC))[1] AS full_name,
               (array_agg(o.shipping_address->>'city' ORDER BY o.created_at DESC))[1] AS city,
               (array_agg(o.shipping_address->>'country' ORDER BY o.created_at DESC))[1] AS country,
               count(*) AS order_count,
               sum(o.total_cents) AS spent_cents,
               min(o.created_at) AS first_order_at,
               max(o.created_at) AS last_order_at
        FROM public.orders o
        WHERE o.customer_email IS NOT NULL
          AND public.order_counts_as_purchase(o.payment_status)
          AND o.customer_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(o.customer_email)))
        GROUP BY lower(btrim(o.customer_email))
      ) g
    ) rows
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customers() TO authenticated;
