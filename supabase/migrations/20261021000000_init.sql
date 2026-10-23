-- Pets Drawings · initial schema (§9)
-- Money is integer cents (EUR). Inventory starts unverified; sale_enabled defaults false.
-- Do not cascade-delete orders or stock movements when archiving products.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.locale_code AS ENUM ('en', 'es');
CREATE TYPE public.currency_code AS ENUM ('EUR');

CREATE TYPE public.product_status AS ENUM ('draft', 'published', 'archived');

CREATE TYPE public.inventory_mode AS ENUM ('tracked', 'made_to_order', 'unverified');

CREATE TYPE public.media_processing_status AS ENUM (
  'pending',
  'processing',
  'ready',
  'failed'
);

CREATE TYPE public.stock_movement_reason AS ENUM (
  'sale',
  'reservation',
  'release',
  'admin_adjust',
  'import',
  'return_restock',
  'correction'
);

CREATE TYPE public.checkout_attempt_status AS ENUM (
  'creating_session',
  'session_open',
  'paid',
  'expired',
  'cancelled',
  'failed',
  'review'
);

CREATE TYPE public.order_payment_status AS ENUM (
  'pending_session',
  'checkout_open',
  'processing',
  'paid',
  'expired',
  'cancelled',
  'partially_refunded',
  'refunded',
  'review'
);

CREATE TYPE public.order_fulfillment_status AS ENUM (
  'unfulfilled',
  'preparing',
  'shipped',
  'completed'
);

CREATE TYPE public.reservation_status AS ENUM (
  'active',
  'consumed',
  'released'
);

CREATE TYPE public.stripe_event_status AS ENUM (
  'received',
  'processing',
  'processed',
  'failed',
  'ignored'
);

CREATE TYPE public.outbox_status AS ENUM (
  'pending',
  'leased',
  'sent',
  'failed',
  'cancelled'
);

CREATE TYPE public.commission_request_status AS ENUM (
  'received',
  'reviewing',
  'quoted',
  'accepted',
  'declined',
  'closed'
);

CREATE TYPE public.commission_file_status AS ENUM (
  'pending_validation',
  'accepted',
  'rejected',
  'removed'
);

CREATE TYPE public.contact_message_status AS ENUM (
  'received',
  'read',
  'archived'
);

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name_en text NOT NULL,
  name_es text NOT NULL,
  slug_en text NOT NULL,
  slug_es text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_code_unique UNIQUE (code),
  CONSTRAINT categories_slug_en_unique UNIQUE (slug_en),
  CONSTRAINT categories_slug_es_unique UNIQUE (slug_es),
  CONSTRAINT categories_code_format CHECK (code ~ '^[a-z0-9-]+$')
);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id bigint,
  sku text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories (id) ON DELETE RESTRICT,
  motif text NOT NULL,
  status public.product_status NOT NULL DEFAULT 'draft',
  price_cents integer NOT NULL,
  currency public.currency_code NOT NULL DEFAULT 'EUR',
  editorial_order integer NOT NULL DEFAULT 0,
  sale_enabled boolean NOT NULL DEFAULT false,
  price_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT products_legacy_id_unique UNIQUE (legacy_id),
  CONSTRAINT products_sku_unique UNIQUE (sku),
  CONSTRAINT products_price_cents_positive CHECK (price_cents > 0),
  CONSTRAINT products_price_version_positive CHECK (price_version > 0),
  CONSTRAINT products_currency_eur CHECK (currency = 'EUR')
);

CREATE INDEX products_category_id_idx ON public.products (category_id);
CREATE INDEX products_status_idx ON public.products (status);
CREATE INDEX products_editorial_order_idx ON public.products (editorial_order);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.product_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  locale public.locale_code NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  details_confirmed jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo_title text,
  seo_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_translations_product_locale_unique UNIQUE (product_id, locale),
  CONSTRAINT product_translations_locale_slug_unique UNIQUE (locale, slug),
  CONSTRAINT product_translations_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TRIGGER product_translations_set_updated_at
  BEFORE UPDATE ON public.product_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id bigint,
  origin text NOT NULL DEFAULT 'upload',
  bucket text NOT NULL,
  object_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint,
  width_px integer,
  height_px integer,
  content_hash text,
  derivatives jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status public.media_processing_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_legacy_id_unique UNIQUE (legacy_id),
  CONSTRAINT media_assets_bucket_path_unique UNIQUE (bucket, object_path),
  CONSTRAINT media_assets_byte_size_nonneg CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT media_assets_dims_positive CHECK (
    (width_px IS NULL OR width_px > 0)
    AND (height_px IS NULL OR height_px > 0)
  )
);

CREATE INDEX media_assets_content_hash_idx ON public.media_assets (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TRIGGER media_assets_set_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.media_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id uuid NOT NULL REFERENCES public.media_assets (id) ON DELETE CASCADE,
  locale public.locale_code NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_translations_asset_locale_unique UNIQUE (media_asset_id, locale)
);

CREATE TRIGGER media_translations_set_updated_at
  BEFORE UPDATE ON public.media_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES public.media_assets (id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_images_product_media_unique UNIQUE (product_id, media_asset_id),
  CONSTRAINT product_images_position_nonneg CHECK (position >= 0)
);

CREATE INDEX product_images_product_id_idx ON public.product_images (product_id, position);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

CREATE TABLE public.inventory (
  product_id uuid PRIMARY KEY REFERENCES public.products (id) ON DELETE RESTRICT,
  stock_on_hand integer NOT NULL DEFAULT 0,
  stock_reserved integer NOT NULL DEFAULT 0,
  inventory_mode public.inventory_mode NOT NULL DEFAULT 'unverified',
  verified_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_stock_on_hand_nonneg CHECK (stock_on_hand >= 0),
  CONSTRAINT inventory_stock_reserved_nonneg CHECK (stock_reserved >= 0),
  CONSTRAINT inventory_reserved_lte_on_hand CHECK (
    inventory_mode <> 'tracked' OR stock_reserved <= stock_on_hand
  ),
  CONSTRAINT inventory_version_positive CHECK (version > 0),
  CONSTRAINT inventory_made_to_order_verified CHECK (
    inventory_mode <> 'made_to_order' OR verified_at IS NOT NULL
  )
);

CREATE TRIGGER inventory_set_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Shop settings (singleton row id = 1)
-- ---------------------------------------------------------------------------

CREATE TABLE public.shop_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_name text NOT NULL DEFAULT 'Pets Drawings',
  sales_enabled boolean NOT NULL DEFAULT false,
  payments_enabled boolean NOT NULL DEFAULT false,
  tax_policy text NOT NULL DEFAULT 'unconfigured',
  shipping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notices jsonb NOT NULL DEFAULT '{}'::jsonb,
  cart_max_qty_per_line integer NOT NULL DEFAULT 20,
  cart_max_lines integer NOT NULL DEFAULT 20,
  cart_max_units integer NOT NULL DEFAULT 40,
  quote_ttl_seconds integer NOT NULL DEFAULT 300,
  reservation_minutes integer NOT NULL DEFAULT 35,
  config_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_settings_limits_positive CHECK (
    cart_max_qty_per_line > 0
    AND cart_max_lines > 0
    AND cart_max_units > 0
    AND quote_ttl_seconds > 0
    AND reservation_minutes > 0
    AND config_version > 0
  )
);

CREATE TRIGGER shop_settings_set_updated_at
  BEFORE UPDATE ON public.shop_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Checkout quotes & attempts
-- ---------------------------------------------------------------------------

CREATE TABLE public.checkout_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_owner_hash text NOT NULL,
  locale public.locale_code NOT NULL,
  lines jsonb NOT NULL,
  price_fingerprint text NOT NULL,
  config_version integer NOT NULL,
  subtotal_cents integer NOT NULL,
  shipping_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL,
  currency public.currency_code NOT NULL DEFAULT 'EUR',
  shipping_zone text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_quotes_amounts_nonneg CHECK (
    subtotal_cents >= 0
    AND shipping_cents >= 0
    AND tax_cents >= 0
    AND total_cents >= 0
  ),
  CONSTRAINT checkout_quotes_total_matches CHECK (
    total_cents = subtotal_cents + shipping_cents + tax_cents
  ),
  CONSTRAINT checkout_quotes_currency_eur CHECK (currency = 'EUR')
);

CREATE INDEX checkout_quotes_cart_owner_hash_idx
  ON public.checkout_quotes (cart_owner_hash);
CREATE INDEX checkout_quotes_expires_at_idx
  ON public.checkout_quotes (expires_at);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  payment_status public.order_payment_status NOT NULL DEFAULT 'pending_session',
  fulfillment_status public.order_fulfillment_status NOT NULL DEFAULT 'unfulfilled',
  locale public.locale_code NOT NULL,
  currency public.currency_code NOT NULL DEFAULT 'EUR',
  subtotal_cents integer NOT NULL,
  shipping_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL,
  customer_email text,
  customer_name text,
  shipping_address jsonb,
  access_token_hash text NOT NULL,
  stripe_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_reference_unique UNIQUE (reference),
  CONSTRAINT orders_stripe_session_id_unique UNIQUE (stripe_session_id),
  CONSTRAINT orders_stripe_payment_intent_id_unique UNIQUE (stripe_payment_intent_id),
  CONSTRAINT orders_amounts_nonneg CHECK (
    subtotal_cents >= 0
    AND shipping_cents >= 0
    AND tax_cents >= 0
    AND total_cents >= 0
  ),
  CONSTRAINT orders_total_matches CHECK (
    total_cents = subtotal_cents + shipping_cents + tax_cents
  ),
  CONSTRAINT orders_currency_eur CHECK (currency = 'EUR')
);

CREATE INDEX orders_payment_status_idx ON public.orders (payment_status);
CREATE INDEX orders_created_at_idx ON public.orders (created_at DESC);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products (id) ON DELETE RESTRICT,
  product_title text NOT NULL,
  product_sku text NOT NULL,
  unit_price_cents integer NOT NULL,
  quantity integer NOT NULL,
  line_subtotal_cents integer NOT NULL,
  media_asset_id uuid REFERENCES public.media_assets (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0 AND quantity <= 9999),
  CONSTRAINT order_items_unit_price_positive CHECK (unit_price_cents > 0),
  CONSTRAINT order_items_line_subtotal_matches CHECK (
    line_subtotal_cents = unit_price_cents * quantity
  )
);

CREATE INDEX order_items_order_id_idx ON public.order_items (order_id);
CREATE INDEX order_items_product_id_idx ON public.order_items (product_id);

CREATE TABLE public.checkout_attempts (
  id uuid PRIMARY KEY,
  cart_owner_hash text NOT NULL,
  quote_id uuid NOT NULL REFERENCES public.checkout_quotes (id) ON DELETE RESTRICT,
  request_hash text NOT NULL,
  order_id uuid REFERENCES public.orders (id) ON DELETE RESTRICT,
  status public.checkout_attempt_status NOT NULL DEFAULT 'creating_session',
  stripe_payload jsonb,
  stripe_session_id text,
  stripe_idempotency_key text NOT NULL,
  session_expires_at timestamptz,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_attempts_stripe_session_id_unique UNIQUE (stripe_session_id),
  CONSTRAINT checkout_attempts_stripe_idempotency_key_unique UNIQUE (stripe_idempotency_key)
);

CREATE INDEX checkout_attempts_cart_owner_hash_idx
  ON public.checkout_attempts (cart_owner_hash);
CREATE INDEX checkout_attempts_status_idx
  ON public.checkout_attempts (status);
CREATE INDEX checkout_attempts_order_id_idx
  ON public.checkout_attempts (order_id);

CREATE TRIGGER checkout_attempts_set_updated_at
  BEFORE UPDATE ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Stock reservations & movements
-- ---------------------------------------------------------------------------

CREATE TABLE public.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id uuid NOT NULL REFERENCES public.checkout_attempts (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  status public.reservation_status NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_reservations_attempt_product_unique UNIQUE (checkout_attempt_id, product_id),
  CONSTRAINT stock_reservations_quantity_positive CHECK (quantity > 0 AND quantity <= 9999)
);

CREATE INDEX stock_reservations_status_expires_idx
  ON public.stock_reservations (status, expires_at);
CREATE INDEX stock_reservations_product_id_idx
  ON public.stock_reservations (product_id);

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  quantity_delta integer NOT NULL,
  reason public.stock_movement_reason NOT NULL,
  order_id uuid REFERENCES public.orders (id) ON DELETE RESTRICT,
  order_item_id uuid REFERENCES public.order_items (id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES public.stock_reservations (id) ON DELETE RESTRICT,
  admin_user_id uuid,
  dedupe_key text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_dedupe_key_unique UNIQUE (dedupe_key),
  CONSTRAINT stock_movements_quantity_nonzero CHECK (quantity_delta <> 0)
);

-- Unique sale movement per order line (prevents double decrement)
CREATE UNIQUE INDEX stock_movements_sale_order_item_unique
  ON public.stock_movements (order_id, order_item_id)
  WHERE reason = 'sale' AND order_item_id IS NOT NULL;

CREATE INDEX stock_movements_product_id_idx ON public.stock_movements (product_id);
CREATE INDEX stock_movements_order_id_idx ON public.stock_movements (order_id);

-- ---------------------------------------------------------------------------
-- Stripe events & notification outbox
-- ---------------------------------------------------------------------------

CREATE TABLE public.stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  related_object_id text,
  status public.stripe_event_status NOT NULL DEFAULT 'received',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT stripe_events_attempt_count_nonneg CHECK (attempt_count >= 0)
);

CREATE INDEX stripe_events_status_idx ON public.stripe_events (status);
CREATE INDEX stripe_events_related_object_id_idx
  ON public.stripe_events (related_object_id)
  WHERE related_object_id IS NOT NULL;

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL,
  recipient text NOT NULL,
  locale public.locale_code NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.outbox_status NOT NULL DEFAULT 'pending',
  lease_until timestamptz,
  lease_owner text,
  attempt_count integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT notification_outbox_dedupe_key_unique UNIQUE (dedupe_key),
  CONSTRAINT notification_outbox_attempt_count_nonneg CHECK (attempt_count >= 0)
);

CREATE INDEX notification_outbox_claim_idx
  ON public.notification_outbox (status, next_run_at)
  WHERE status IN ('pending', 'leased', 'failed');

CREATE TRIGGER notification_outbox_set_updated_at
  BEFORE UPDATE ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  permissions jsonb NOT NULL DEFAULT '{"role":"admin"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TRIGGER admin_users_set_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  operation text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  change jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_actor_idx ON public.admin_audit_log (actor_user_id);
CREATE INDEX admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX admin_audit_log_entity_idx
  ON public.admin_audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Commissions & contact
-- ---------------------------------------------------------------------------

CREATE TABLE public.commission_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  locale public.locale_code NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  size_hint text,
  subjects text,
  message text NOT NULL,
  status public.commission_request_status NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_requests_reference_unique UNIQUE (reference)
);

CREATE TRIGGER commission_requests_set_updated_at
  BEFORE UPDATE ON public.commission_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.commission_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_request_id uuid NOT NULL
    REFERENCES public.commission_requests (id) ON DELETE RESTRICT,
  media_asset_id uuid REFERENCES public.media_assets (id) ON DELETE RESTRICT,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  validation_notes text,
  status public.commission_file_status NOT NULL DEFAULT 'pending_validation',
  temporary_owner_token_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_files_byte_size_positive CHECK (byte_size > 0)
);

CREATE INDEX commission_files_request_id_idx
  ON public.commission_files (commission_request_id);

CREATE TABLE public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale public.locale_code NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  message text NOT NULL,
  status public.contact_message_status NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER contact_messages_set_updated_at
  BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX contact_messages_status_idx ON public.contact_messages (status);

-- ---------------------------------------------------------------------------
-- Public catalog views (column-limited; no internal inventory/admin fields)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.catalog_categories_v
WITH (security_invoker = false)
AS
SELECT
  c.id,
  c.code,
  c.name_en,
  c.name_es,
  c.slug_en,
  c.slug_es,
  c.sort_order
FROM public.categories c;

CREATE OR REPLACE VIEW public.catalog_products_v
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.sku,
  c.code AS category_code,
  p.motif,
  p.status,
  p.price_cents,
  p.currency,
  p.editorial_order,
  p.sale_enabled,
  inv.inventory_mode,
  CASE
    WHEN p.status <> 'published' THEN 'unavailable'
    WHEN NOT p.sale_enabled OR inv.inventory_mode = 'unverified' THEN 'unverified'
    WHEN inv.inventory_mode = 'made_to_order' THEN 'available'
    WHEN inv.stock_on_hand - inv.stock_reserved > 0 THEN 'available'
    ELSE 'sold_out'
  END AS availability,
  p.updated_at
FROM public.products p
JOIN public.categories c ON c.id = p.category_id
JOIN public.inventory inv ON inv.product_id = p.id
WHERE p.status = 'published';

CREATE OR REPLACE VIEW public.catalog_product_translations_v
WITH (security_invoker = false)
AS
SELECT
  pt.product_id,
  pt.locale,
  pt.slug,
  pt.title,
  pt.summary,
  pt.description,
  pt.details_confirmed,
  pt.seo_title,
  pt.seo_description
FROM public.product_translations pt
JOIN public.products p ON p.id = pt.product_id
WHERE p.status = 'published';

CREATE OR REPLACE VIEW public.catalog_product_images_v
WITH (security_invoker = false)
AS
SELECT
  pi.product_id,
  pi.media_asset_id,
  pi.position,
  pi.is_cover,
  ma.bucket,
  ma.object_path,
  ma.mime_type,
  ma.width_px,
  ma.height_px,
  ma.derivatives
FROM public.product_images pi
JOIN public.products p ON p.id = pi.product_id
JOIN public.media_assets ma ON ma.id = pi.media_asset_id
WHERE p.status = 'published'
  AND ma.bucket IN ('catalog-public', 'portfolio-public')
  AND ma.processing_status = 'ready';

COMMENT ON VIEW public.catalog_products_v IS
  'Public shop projection: published products only; no raw stock counts.';
