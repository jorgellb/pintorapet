-- Customers in the admin: accounts and guest buyers, with their orders.
-- Reads only; creating, editing and deleting accounts happens on the server
-- with the service role after requireAdmin().

-- Statuses that count as a purchase.
CREATE OR REPLACE FUNCTION public.order_counts_as_purchase(p_status public.order_payment_status)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_status IN ('paid', 'review', 'partially_refunded', 'refunded');
$$;

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
        SELECT lower(o.customer_email) AS email,
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
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(o.customer_email))
        GROUP BY lower(o.customer_email)
      ) g
    ) rows
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customers() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_customer(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_profile public.customers%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_user FROM auth.users WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_profile FROM public.customers WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'confirmed', v_user.email_confirmed_at IS NOT NULL,
    'created_at', v_user.created_at,
    'last_sign_in_at', v_user.last_sign_in_at,
    'is_admin', EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = v_user.id AND a.is_active),
    'full_name', coalesce(nullif(v_profile.full_name, ''), v_user.raw_user_meta_data->>'full_name', ''),
    'phone', coalesce(v_profile.phone, ''),
    'address', v_profile.address,
    'billing', v_profile.billing,
    'orders', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'reference', o.reference,
        'created_at', o.created_at,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status,
        'total_cents', o.total_cents,
        'linked', o.customer_id = v_user.id
      ) ORDER BY o.created_at DESC), '[]'::jsonb)
      FROM public.orders o
      WHERE (o.customer_id = v_user.id OR lower(o.customer_email) = lower(v_user.email))
        AND o.payment_status NOT IN ('pending_session', 'checkout_open')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer(uuid) TO authenticated;
