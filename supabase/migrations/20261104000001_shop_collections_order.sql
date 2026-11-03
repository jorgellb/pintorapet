-- Save the order of the shop categories in one statement (Admin › Tienda ›
-- Categorías), instead of one request per category.
CREATE OR REPLACE FUNCTION public.admin_reorder_shop_collections(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.shop_collections sc
  SET sort_order = o.position * 10
  FROM unnest(p_ids) WITH ORDINALITY AS o(id, position)
  WHERE sc.id = o.id AND sc.sort_order IS DISTINCT FROM o.position * 10;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reorder_shop_collections(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_shop_collections(uuid[]) TO authenticated;
