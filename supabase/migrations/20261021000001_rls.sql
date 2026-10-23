-- Pets Drawings · RLS (§10.2)
-- Actors: anon visitor, authenticated (non-admin), admin via admin_users, service_role (bypass).

-- Supabase roles (no-op when already present; enables plain-Postgres dry runs)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Stub auth.uid() only when Supabase Auth is absent (local plain Postgres).
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    EXECUTE $fn$
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$
    $fn$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True when the verified auth user has an active admin_users membership.';

-- ---------------------------------------------------------------------------
-- Enable RLS on all application tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Privileges: anon/authenticated use catalog views; admins use base tables + RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories',
    'products',
    'product_translations',
    'media_assets',
    'media_translations',
    'product_images',
    'inventory',
    'stock_movements',
    'checkout_quotes',
    'checkout_attempts',
    'orders',
    'order_items',
    'stock_reservations',
    'stripe_events',
    'notification_outbox',
    'admin_users',
    'admin_audit_log',
    'commission_requests',
    'commission_files',
    'contact_messages',
    'shop_settings'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF has_auth THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
        t
      );
    END IF;
  END LOOP;

  -- Public catalog via column-limited views only (no base-table SELECT for anon)
  IF has_anon THEN
    GRANT SELECT ON public.catalog_categories_v TO anon;
    GRANT SELECT ON public.catalog_products_v TO anon;
    GRANT SELECT ON public.catalog_product_translations_v TO anon;
    GRANT SELECT ON public.catalog_product_images_v TO anon;
  END IF;
  IF has_auth THEN
    GRANT SELECT ON public.catalog_categories_v TO authenticated;
    GRANT SELECT ON public.catalog_products_v TO authenticated;
    GRANT SELECT ON public.catalog_product_translations_v TO authenticated;
    GRANT SELECT ON public.catalog_product_images_v TO authenticated;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Categories: admin full; no direct public table read (use view)
-- ---------------------------------------------------------------------------

CREATE POLICY categories_admin_all
  ON public.categories
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Products & translations & images: admin full
-- ---------------------------------------------------------------------------

CREATE POLICY products_admin_all
  ON public.products
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY product_translations_admin_all
  ON public.product_translations
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY product_images_admin_all
  ON public.product_images
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Media: admin full; no public row access (public images via catalog view)
-- ---------------------------------------------------------------------------

CREATE POLICY media_assets_admin_all
  ON public.media_assets
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY media_translations_admin_all
  ON public.media_translations
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Inventory, movements, commerce internals: admin read/write; no public
-- ---------------------------------------------------------------------------

CREATE POLICY inventory_admin_all
  ON public.inventory
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY stock_movements_admin_select
  ON public.stock_movements
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY stock_movements_admin_insert
  ON public.stock_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- No public UPDATE/DELETE on movements (immutable ledger); admin insert only via app/fns

CREATE POLICY checkout_quotes_admin_select
  ON public.checkout_quotes
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY checkout_attempts_admin_select
  ON public.checkout_attempts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY checkout_attempts_admin_update
  ON public.checkout_attempts
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY orders_admin_all
  ON public.orders
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY order_items_admin_select
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY stock_reservations_admin_select
  ON public.stock_reservations
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY stripe_events_admin_select
  ON public.stripe_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY notification_outbox_admin_select
  ON public.notification_outbox
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin membership & audit
-- ---------------------------------------------------------------------------

-- Active admins can read membership rows; no self-insert (bootstrap via service role)
CREATE POLICY admin_users_admin_select
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_users_admin_update
  ON public.admin_users
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY admin_audit_log_admin_select
  ON public.admin_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_audit_log_admin_insert
  ON public.admin_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND actor_user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Commissions & contact: admin manage; inserts go through server/service role
-- ---------------------------------------------------------------------------

CREATE POLICY commission_requests_admin_all
  ON public.commission_requests
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY commission_files_admin_all
  ON public.commission_files
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY contact_messages_admin_all
  ON public.contact_messages
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Shop settings: admin only (sales flags are not public Data API)
-- ---------------------------------------------------------------------------

CREATE POLICY shop_settings_admin_all
  ON public.shop_settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Notes
-- service_role bypasses RLS for checkout/webhook/outbox workers.
-- Privileged commerce mutations live in SECURITY DEFINER functions
-- (see 20261021000002_commerce_fns.sql) with EXECUTE revoked from anon.
-- ---------------------------------------------------------------------------
