-- Christmas ornaments: a fourth product type, next to cards, coasters and
-- mugs. VAT stays at the general 21 % (products_default_vat); a bauble with
-- its bow weighs about 60 g, which is what new ones start with.

INSERT INTO public.categories (code, name_en, name_es, slug_en, slug_es, sort_order)
VALUES ('ornaments', 'Christmas Ornaments', 'Bolas de Navidad', 'christmas-ornaments', 'bolas-de-navidad', 4)
ON CONFLICT (code) DO NOTHING;

-- New products start with their type's usual weight; variants with their parent's.
CREATE OR REPLACE FUNCTION public.products_default_weight()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT weight_grams INTO NEW.weight_grams FROM public.products WHERE id = NEW.parent_id;
  ELSE
    SELECT CASE code
      WHEN 'greeting-cards' THEN 30
      WHEN 'coasters' THEN 90
      WHEN 'mugs' THEN 450
      WHEN 'ornaments' THEN 60
      ELSE NEW.weight_grams
    END INTO NEW.weight_grams
    FROM public.categories WHERE id = NEW.category_id;
  END IF;
  NEW.weight_grams := coalesce(NEW.weight_grams, 100);
  RETURN NEW;
END;
$$;
