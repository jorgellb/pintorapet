-- Product types (cards, coasters, mugs…) become editable in Admin › Tienda ›
-- Tipos de producto. Each type now holds what the code used to fix:
--   name_es / name_en          plural, on the shop's filters ("Tazas")
--   singular_es / singular_en  on the price tag and in a portrait's row ("Taza")
--   phrase_es / phrase_en      mid-sentence ("bola de Navidad"); empty = the
--                              singular with a lowercase first letter
--   icon                       one of the drawings the shop has
--   default_weight_grams       the weight new products start with
--   vat_rate                   the VAT new products start with
--   google_category            for the Google and Meta catalogues
--   published                  hidden types leave the shop list and filters;
--                              their product pages stay
-- sort_order (already there) is the order of the filters.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS singular_es text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS singular_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phrase_es text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phrase_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'tag',
  ADD COLUMN IF NOT EXISTS default_weight_grams integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(4,2) NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS google_category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;

-- What the shop, the admin and the catalogues said until now.
UPDATE public.categories c
SET name_es = v.name_es, name_en = v.name_en,
    singular_es = v.singular_es, singular_en = v.singular_en,
    phrase_es = v.phrase_es, phrase_en = v.phrase_en,
    icon = v.icon, default_weight_grams = v.weight, google_category = v.google,
    sort_order = v.position * 10
FROM (VALUES
  ('greeting-cards', 'Tarjetas', 'Cards', 'Tarjeta', 'Card', '', '', 'card', 30,
   'Arts & Entertainment > Party & Celebration > Gift Giving > Greeting Cards', 1),
  ('coasters', 'Posavasos', 'Coasters', 'Posavasos', 'Coaster', '', '', 'coaster', 90,
   'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Coasters', 2),
  ('mugs', 'Tazas', 'Mugs', 'Taza', 'Mug', '', '', 'mug', 450,
   'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs', 3),
  ('ornaments', 'Bolas de Navidad', 'Christmas ornaments', 'Bola de Navidad', 'Christmas ornament', '', 'Christmas ornament', 'ornament', 60,
   'Home & Garden > Decor > Seasonal & Holiday Decorations > Holiday Ornaments', 4),
  ('keyrings', 'Llaveros', 'Keyrings', 'Llavero', 'Keyring', '', '', 'keyring', 20,
   'Apparel & Accessories > Handbag & Wallet Accessories > Keychains', 5)
) AS v(code, name_es, name_en, singular_es, singular_en, phrase_es, phrase_en, icon, weight, google, position)
WHERE c.code = v.code;

-- Any other type: its singular starts as its name.
UPDATE public.categories SET singular_es = name_es WHERE btrim(singular_es) = '';
UPDATE public.categories SET singular_en = name_en WHERE btrim(singular_en) = '';

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_names,
  ADD CONSTRAINT categories_names CHECK (
    length(btrim(name_es)) BETWEEN 1 AND 60 AND length(btrim(name_en)) BETWEEN 1 AND 60
    AND length(btrim(singular_es)) BETWEEN 1 AND 60 AND length(btrim(singular_en)) BETWEEN 1 AND 60
    AND length(phrase_es) <= 60 AND length(phrase_en) <= 60
  ),
  DROP CONSTRAINT IF EXISTS categories_icon,
  ADD CONSTRAINT categories_icon CHECK (icon IN ('card', 'coaster', 'mug', 'ornament', 'keyring', 'print', 'bag', 'tag')),
  DROP CONSTRAINT IF EXISTS categories_weight,
  ADD CONSTRAINT categories_weight CHECK (default_weight_grams BETWEEN 1 AND 30000),
  DROP CONSTRAINT IF EXISTS categories_vat,
  ADD CONSTRAINT categories_vat CHECK (vat_rate IN (0, 4, 10, 21)),
  DROP CONSTRAINT IF EXISTS categories_google,
  ADD CONSTRAINT categories_google CHECK (length(google_category) <= 250);

-- New products start with their type's weight and VAT; options with their product's.
CREATE OR REPLACE FUNCTION public.products_default_weight()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT weight_grams INTO NEW.weight_grams FROM public.products WHERE id = NEW.parent_id;
  ELSE
    SELECT default_weight_grams INTO NEW.weight_grams FROM public.categories WHERE id = NEW.category_id;
  END IF;
  NEW.weight_grams := coalesce(NEW.weight_grams, 100);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.products_default_vat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT vat_rate INTO NEW.vat_rate FROM public.products WHERE id = NEW.parent_id;
  ELSE
    SELECT vat_rate INTO NEW.vat_rate FROM public.categories WHERE id = NEW.category_id;
  END IF;
  NEW.vat_rate := coalesce(NEW.vat_rate, 21);
  RETURN NEW;
END;
$$;

-- What the shop reads: the visible types, with everything it shows (new
-- columns last, so existing readers are unaffected).
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
  c.sort_order,
  c.singular_es,
  c.singular_en,
  c.phrase_es,
  c.phrase_en,
  c.icon,
  c.google_category
FROM public.categories c
WHERE c.published;

-- Save the order of the types (the shop's filters) in one statement.
CREATE OR REPLACE FUNCTION public.admin_reorder_product_types(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.categories c
  SET sort_order = o.position * 10
  FROM unnest(p_ids) WITH ORDINALITY AS o(id, position)
  WHERE c.id = o.id AND c.sort_order IS DISTINCT FROM o.position * 10;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reorder_product_types(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_product_types(uuid[]) TO authenticated;
