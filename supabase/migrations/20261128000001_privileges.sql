-- What visitors (anon) and signed-in people (authenticated) may do, written
-- down in one place.
--
-- The prelude gave both roles ALL on every new table, sequence and function
-- (Supabase's defaults) and some migrations never took it back, so:
--   * seven service-only functions (taking payments, reserving stock, handing
--     out queued emails...) could be run as a visitor;
--   * visitors and customers could TRUNCATE tables (customers, invoice series,
--     shipping rates...) and write through the catalogue views.
-- The app never runs user SQL as those roles, so none of it was reachable,
-- but these grants are the only barrier if that ever changed.
--
-- Rules from here on:
--   * nobody but the owner truncates, references, triggers or maintains;
--   * visitors only read: the catalogue views and the published rows their
--     policies show;
--   * signed-in users read and write under RLS (Admin is a signed-in user),
--     never through the views;
--   * functions keep PostgreSQL's default (PUBLIC may run them) unless a
--     migration revokes it; service-only ones are revoked from everyone, and
--     the ones Admin and customers call are granted to authenticated by name.
-- supabase/aiven/00_prelude.sql sets the matching defaults for new objects.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ---------------------------------------------------------------------------
-- Tables and views
-- ---------------------------------------------------------------------------

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- Tables visitors have no policy on: nothing to read there.
REVOKE ALL ON public.customers, public.payment_providers, public.invoices, public.invoice_series FROM anon;

-- What visitors read: published rows (their policies) and the catalogue.
GRANT SELECT ON public.markets, public.market_photos, public.reviews, public.site_home_hero, public.site_home_sections TO anon;

-- The catalogue and editorial views are read-only projections.
REVOKE INSERT, UPDATE, DELETE ON
  public.catalog_categories_v, public.catalog_collections_v, public.catalog_product_images_v,
  public.catalog_product_translations_v, public.catalog_products_v,
  public.editorial_artworks_v, public.editorial_gallery_v
FROM authenticated;
GRANT SELECT ON
  public.catalog_categories_v, public.catalog_collections_v, public.catalog_product_images_v,
  public.catalog_product_translations_v, public.catalog_products_v,
  public.editorial_artworks_v, public.editorial_gallery_v
TO anon, authenticated;

-- Sequences: nobody but the owner moves them (setval).
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  f record;
BEGIN
  -- Service only: the app calls these as the owner (webhooks, checkout, the outbox).
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('apply_payment', 'reserve_checkout', 'attach_stripe_session', 'set_order_access_token',
                        'claim_outbox', 'release_reservations')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;

  -- Open to everyone through PUBLIC already: the old defaults' copies for the
  -- two roles add nothing (a fresh build has none).
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f.sig);
  END LOOP;

  -- Trigger functions run with the trigger; nobody calls them.
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;

  -- Called by Admin (signed in) and by customers on their own orders. Each
  -- one checks is_admin() or auth.uid() itself.
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'admin_antibot_summary', 'admin_begin_refund', 'admin_cancel_order', 'admin_complete_refund',
        'admin_connect_carrier', 'admin_connect_payment_provider', 'admin_create_manual_order', 'admin_create_product',
        'admin_customer', 'admin_customers', 'admin_delete_abandoned_orders', 'admin_delete_order',
        'admin_delete_product', 'admin_disconnect_carrier', 'admin_disconnect_payment_provider', 'admin_fail_refund',
        'admin_issue_invoice', 'admin_issue_pending_invoices', 'admin_mark_order_paid', 'admin_mark_refund_processing',
        'admin_market_sale', 'admin_quote_manual_order', 'admin_refund_left', 'admin_reorder_product_types',
        'admin_reorder_products', 'admin_reorder_shop_collections', 'admin_resolve_payment_review',
        'admin_save_shipping_zone', 'admin_set_order_archived', 'adjust_inventory',
        'customer_invoice', 'customer_order', 'customer_orders', 'request_full_invoice'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;

  -- Policies (visitors' ones too) and the guest order page use these.
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('is_admin', 'lookup_guest_order')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.sig);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- adjust_inventory: the admin is the one signed in, not an id the caller sends
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_product_id uuid,
  p_stock_on_hand integer,
  p_inventory_mode public.inventory_mode,
  p_admin_user_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inv public.inventory%ROWTYPE;
  v_delta integer;
BEGIN
  IF NOT public.is_admin() OR p_admin_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  IF p_stock_on_hand IS NULL OR p_stock_on_hand < 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.inventory WHERE product_id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_stock_on_hand < v_inv.stock_reserved AND p_inventory_mode = 'tracked' THEN
    RAISE EXCEPTION 'STOCK_BELOW_RESERVED' USING ERRCODE = 'P0001';
  END IF;

  v_delta := p_stock_on_hand - v_inv.stock_on_hand;

  UPDATE public.inventory
  SET
    stock_on_hand = p_stock_on_hand,
    inventory_mode = p_inventory_mode,
    verified_at = CASE
      WHEN p_inventory_mode = 'unverified' THEN NULL
      ELSE coalesce(verified_at, now())
    END,
    version = version + 1
  WHERE product_id = p_product_id
  RETURNING * INTO v_inv;

  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements (
      product_id, quantity_delta, reason, admin_user_id, dedupe_key, note
    ) VALUES (
      p_product_id,
      v_delta,
      'admin_adjust',
      p_admin_user_id,
      'admin_adjust:' || p_product_id::text || ':' || v_inv.version::text || ':' || gen_random_uuid()::text,
      p_note
    );
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, operation, entity_type, entity_id, change
  ) VALUES (
    p_admin_user_id,
    'adjust_inventory',
    'inventory',
    p_product_id::text,
    jsonb_build_object(
      'stock_on_hand', p_stock_on_hand,
      'inventory_mode', p_inventory_mode,
      'delta', v_delta
    )
  );

  RETURN v_inv;
END;
$$;
