-- The order of the pieces of one type (Admin › Productos › Tazas ↑↓), which is
-- the order the shop shows when a visitor picks that type.
--
-- The products of that type swap the places they already hold in
-- editorial_order, so the other types keep theirs. Each option (variant)
-- follows its product.
CREATE OR REPLACE FUNCTION public.admin_reorder_products(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_found integer;
  v_types integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(DISTINCT p.category_id)
  INTO v_found, v_types
  FROM public.products p
  WHERE p.id = ANY (p_ids) AND p.parent_id IS NULL;

  IF coalesce(array_length(p_ids, 1), 0) = 0
     OR v_found <> array_length(p_ids, 1)
     OR (SELECT count(DISTINCT id) FROM unnest(p_ids) AS u(id)) <> array_length(p_ids, 1)
     OR v_types <> 1 THEN
    RAISE EXCEPTION 'INVALID_ORDER: one type of product, each once, no options' USING ERRCODE = '22023';
  END IF;

  WITH slots AS (
    SELECT p.editorial_order, row_number() OVER (ORDER BY p.editorial_order, p.id) AS position
    FROM public.products p
    WHERE p.id = ANY (p_ids)
  ),
  wanted AS (
    SELECT o.id, o.position
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, position)
  )
  UPDATE public.products p
  SET editorial_order = s.editorial_order
  FROM wanted w
  JOIN slots s ON s.position = w.position
  WHERE p.id = w.id AND p.editorial_order IS DISTINCT FROM s.editorial_order;

  UPDATE public.products v
  SET editorial_order = p.editorial_order
  FROM public.products p
  WHERE v.parent_id = p.id
    AND p.id = ANY (p_ids)
    AND v.editorial_order IS DISTINCT FROM p.editorial_order;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reorder_products(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_products(uuid[]) TO authenticated;
