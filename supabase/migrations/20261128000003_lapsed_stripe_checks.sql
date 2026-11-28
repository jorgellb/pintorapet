-- Lapsed Stripe checkouts are asked about at most every 30 minutes, ten at a
-- time, and never crowd out the others.
--
-- lapsed_attempts listed the Stripe sessions that ended without an "expired"
-- webhook among the first 50 lapsed checkouts. One that Stripe still has as
-- complete (paid with a late webhook, or a slow payment on its way) stays in
-- the list, so enough of them could take every place and stop the other
-- checkouts from ever being freed, and each was asked about on every run.
-- Now the ones freed without asking come first, those needing Stripe are
-- capped (p_ask_limit), and one asked about in the last 30 minutes waits
-- (stripe_checked_at, set by lib/server/commerce/lapsed.ts).

ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS stripe_checked_at timestamptz;

COMMENT ON COLUMN public.checkout_attempts.stripe_checked_at IS
  'When the server last asked Stripe about this lapsed session (it was not expired yet).';

DROP FUNCTION IF EXISTS public.lapsed_attempts(integer);

CREATE OR REPLACE FUNCTION public.lapsed_attempts(p_limit integer DEFAULT 50, p_ask_limit integer DEFAULT 10)
RETURNS TABLE (attempt_id uuid, provider text, stripe_session_id text, ask_stripe boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  (SELECT a.id, a.payment_provider, a.stripe_session_id, false
   FROM public.checkout_attempts a
   WHERE a.status IN ('creating_session', 'session_open')
     AND (
       (a.payment_provider = 'paypal' AND a.session_expires_at < now())
       -- Stripe: its session never opened (the reservation is 35 minutes).
       OR (a.payment_provider = 'stripe' AND a.status = 'creating_session' AND a.created_at < now() - interval '40 minutes')
     )
   ORDER BY a.created_at
   LIMIT greatest(1, least(coalesce(p_limit, 50), 200)))
  UNION ALL
  -- Stripe: its session ended an hour ago and no "expired" webhook came.
  (SELECT a.id, a.payment_provider, a.stripe_session_id, true
   FROM public.checkout_attempts a
   WHERE a.status = 'session_open'
     AND a.payment_provider = 'stripe'
     AND a.session_expires_at < now() - interval '1 hour'
     AND (a.stripe_checked_at IS NULL OR a.stripe_checked_at < now() - interval '30 minutes')
   ORDER BY a.stripe_checked_at NULLS FIRST, a.created_at
   LIMIT greatest(0, least(coalesce(p_ask_limit, 10), 50)));
$$;

REVOKE ALL ON FUNCTION public.lapsed_attempts(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lapsed_attempts(integer, integer) TO service_role;
