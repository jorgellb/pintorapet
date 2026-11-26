-- Gifts and Christmas (checkout and Admin › Envíos).
--
-- An order can be a gift: it travels to the person who receives it (their name
-- is the shipping address's), and the buyer's message is printed on the packing
-- slip instead of the order note.
--
-- Each shipping zone can carry its last day to order in time for Christmas;
-- the shop shows it from 1 November. Starting dates follow Correos' usual
-- Christmas calendar; Meili changes them in Admin › Envíos.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gift_message text;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_gift_message_length;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_gift_message_length CHECK (gift_message IS NULL OR char_length(gift_message) <= 300);

ALTER TABLE public.shipping_zones ADD COLUMN IF NOT EXISTS holiday_deadline date;

UPDATE public.shipping_zones SET holiday_deadline = CASE
    WHEN regions @> ARRAY['peninsula'] THEN DATE '2026-12-18'
    WHEN regions @> ARRAY['baleares'] THEN DATE '2026-12-15'
    WHEN regions && ARRAY['canarias', 'ceuta', 'melilla'] THEN DATE '2026-12-11'
    WHEN countries && ARRAY['FR', 'DE', 'PT', 'IT', 'GB', 'CH', 'NO'] THEN DATE '2026-12-10'
    WHEN countries @> ARRAY['*'] THEN DATE '2026-12-03'
  END
WHERE holiday_deadline IS NULL;
