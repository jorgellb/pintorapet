-- More shipping states, matching what Correos reports, between "Enviado" and
-- "Entregado" (completed), plus the two ways a parcel can go wrong.
-- (On its own: a new enum value cannot be used in the transaction that adds it.)
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'in_transit' AFTER 'shipped';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'out_for_delivery' AFTER 'in_transit';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'incident' AFTER 'completed';
ALTER TYPE public.order_fulfillment_status ADD VALUE IF NOT EXISTS 'returned' AFTER 'incident';
