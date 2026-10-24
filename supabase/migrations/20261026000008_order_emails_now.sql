-- Order emails go out when the order is paid or shipped, not with the next
-- daily outbox run: the server claims just that order's rows and sends them.
-- The cron stays as the safety net for anything that failed.

CREATE OR REPLACE FUNCTION public.claim_outbox_for_order(
  p_order_id uuid,
  p_lease_seconds integer DEFAULT 60,
  p_worker_id text DEFAULT 'worker'
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.payload->>'order_id' = p_order_id::text
      AND o.template_key IN ('order_paid_customer', 'order_paid_admin', 'order_shipped_customer')
      AND o.status IN ('pending', 'failed')
      AND o.next_run_at <= now()
      AND (o.lease_until IS NULL OR o.lease_until < now())
    FOR UPDATE SKIP LOCKED
    LIMIT 10
  )
  UPDATE public.notification_outbox o
  SET
    status = 'leased',
    lease_until = now() + make_interval(secs => greatest(5, coalesce(p_lease_seconds, 60))),
    lease_owner = p_worker_id,
    attempt_count = o.attempt_count + 1
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_outbox_for_order(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_for_order(uuid, integer, text) TO service_role;

-- Three tiers: what customers wait for, then the studio's order and digest
-- notices, then one email per contact or commission message.
CREATE OR REPLACE FUNCTION public.claim_outbox(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60,
  p_worker_id text DEFAULT 'worker'
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.status IN ('pending', 'failed')
      AND o.next_run_at <= now()
      AND (o.lease_until IS NULL OR o.lease_until < now())
    ORDER BY
      CASE
        WHEN o.template_key IN ('contact_admin', 'commission_admin') THEN 2
        WHEN o.template_key IN ('order_paid_admin', 'messages_overflow') THEN 1
        ELSE 0
      END,
      o.next_run_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 100))
  )
  UPDATE public.notification_outbox o
  SET
    status = 'leased',
    lease_until = now() + make_interval(secs => greatest(5, coalesce(p_lease_seconds, 60))),
    lease_owner = p_worker_id,
    attempt_count = o.attempt_count + 1
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;
