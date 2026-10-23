-- Pets Drawings · seed (categories + shop settings only)
-- Product UUIDs / SKUs are created by import scripts — do not invent them here.

INSERT INTO public.categories (code, name_en, name_es, slug_en, slug_es, sort_order)
VALUES
  ('greeting-cards', 'Greeting Cards', 'Tarjetas de felicitación', 'greeting-cards', 'tarjetas-de-felicitacion', 1),
  ('coasters', 'Coasters', 'Posavasos', 'coasters', 'posavasos', 2),
  ('mugs', 'Mugs', 'Tazas', 'mugs', 'tazas', 3)
ON CONFLICT (code) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_es = EXCLUDED.name_es,
  slug_en = EXCLUDED.slug_en,
  slug_es = EXCLUDED.slug_es,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.shop_settings (
  id,
  public_name,
  sales_enabled,
  payments_enabled,
  tax_policy,
  shipping_config,
  notices,
  cart_max_qty_per_line,
  cart_max_lines,
  cart_max_units,
  quote_ttl_seconds,
  reservation_minutes,
  config_version
) VALUES (
  1,
  'Pets Drawings',
  false,
  false,
  'unconfigured',
  '{}'::jsonb,
  jsonb_build_object(
    'availability_en', 'Availability to be confirmed',
    'availability_es', 'Disponibilidad por confirmar'
  ),
  20,
  20,
  40,
  300,
  35,
  1
)
ON CONFLICT (id) DO UPDATE SET
  public_name = EXCLUDED.public_name,
  sales_enabled = false,
  payments_enabled = false,
  tax_policy = EXCLUDED.tax_policy,
  notices = EXCLUDED.notices,
  cart_max_qty_per_line = EXCLUDED.cart_max_qty_per_line,
  cart_max_lines = EXCLUDED.cart_max_lines,
  cart_max_units = EXCLUDED.cart_max_units,
  quote_ttl_seconds = EXCLUDED.quote_ttl_seconds,
  reservation_minutes = EXCLUDED.reservation_minutes,
  updated_at = now();
