-- Orders taken by phone and paid by bank transfer (Admin › Pedidos › Nuevo
-- pedido): a payment state while the transfer arrives, and the method itself.
-- (On its own: a new enum value cannot be used in the transaction that adds it.)
ALTER TYPE public.order_payment_status ADD VALUE IF NOT EXISTS 'awaiting_transfer' AFTER 'pending_session';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_known;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_provider_known CHECK (payment_provider IN ('stripe', 'paypal', 'transfer'));
