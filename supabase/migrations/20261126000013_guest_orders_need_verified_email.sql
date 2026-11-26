-- Deleting an account with «Borrar también sus datos de los pedidos» also erases
-- the guest orders placed with the account's email. That is only safe when the
-- account proved it owns that email: anyone can register with someone else's
-- address and never confirm it. So guest orders with the same email are included
-- only when the account's email is verified; its own orders always are.

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
       AND public.guest_key(o.customer_email) IN (
         SELECT public.guest_key(u.email) FROM auth.users u
         WHERE u.id = p_user_id AND (u.email_verified OR u.email_confirmed_at IS NOT NULL)
       )
     );
$$;

REVOKE ALL ON FUNCTION public.admin_account_order_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_order_ids(uuid) TO service_role;
