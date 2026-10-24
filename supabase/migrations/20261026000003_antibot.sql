-- Anti-bot gate for the public forms (register, sign-in, password link,
-- contact and commissions). The server scores each submission and calls
-- antibot_gate(), which adds rate limits and one-time challenges, and keeps
-- a 30-day log the admin can read. IPs and emails are stored as keyed hashes;
-- only a masked email is kept for the admin.

CREATE TABLE IF NOT EXISTS public.antibot_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form text NOT NULL CHECK (form IN ('register', 'sign_in', 'forgot', 'contact', 'commission')),
  ip_hash text NOT NULL CHECK (length(ip_hash) BETWEEN 16 AND 128),
  email_hash text CHECK (email_hash IS NULL OR length(email_hash) BETWEEN 16 AND 128),
  email_hint text CHECK (email_hint IS NULL OR length(email_hint) <= 80),
  nonce text UNIQUE CHECK (nonce IS NULL OR length(nonce) BETWEEN 16 AND 64),
  verdict text NOT NULL CHECK (verdict IN ('allow', 'block', 'rate')),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS antibot_events_ip_idx ON public.antibot_events (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS antibot_events_email_idx ON public.antibot_events (email_hash, created_at DESC)
  WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS antibot_events_form_idx ON public.antibot_events (form, created_at DESC);

ALTER TABLE public.antibot_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS antibot_events_admin_read ON public.antibot_events;
CREATE POLICY antibot_events_admin_read ON public.antibot_events
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.antibot_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.antibot_events TO authenticated;

-- Record a submission and give the final verdict. A 'block' from the server
-- stays a block; otherwise the one-time challenge and the rate limits decide.
-- Every attempt counts towards the limits, blocked or not.
CREATE OR REPLACE FUNCTION public.antibot_gate(
  p_form text,
  p_ip_hash text,
  p_email_hash text,
  p_email_hint text,
  p_nonce text,
  p_verdict text,
  p_score integer,
  p_reasons text[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_verdict text := p_verdict;
  v_reasons text[] := coalesce(p_reasons, '{}');
  -- {ip per window, window} pairs, then per email, then all visitors per hour
  v_ip_short int; v_ip_short_window interval;
  v_ip_day int;
  v_email int; v_email_window interval;
  v_global int;
  v_count int;
BEGIN
  IF p_verdict NOT IN ('allow', 'block') THEN
    RAISE EXCEPTION 'INVALID_VERDICT' USING ERRCODE = '22023';
  END IF;

  CASE p_form
    WHEN 'register' THEN
      v_ip_short := 3;  v_ip_short_window := interval '1 hour'; v_ip_day := 8;
      v_email := 3;     v_email_window := interval '1 day';     v_global := 40;
    WHEN 'sign_in' THEN
      v_ip_short := 20; v_ip_short_window := interval '15 minutes'; v_ip_day := 120;
      v_email := 8;     v_email_window := interval '15 minutes';    v_global := 600;
    WHEN 'forgot' THEN
      v_ip_short := 5;  v_ip_short_window := interval '1 hour'; v_ip_day := 15;
      v_email := 3;     v_email_window := interval '1 hour';    v_global := 60;
    WHEN 'contact', 'commission' THEN
      v_ip_short := 5;  v_ip_short_window := interval '1 hour'; v_ip_day := 15;
      v_email := 5;     v_email_window := interval '1 day';     v_global := 60;
    ELSE
      RAISE EXCEPTION 'INVALID_FORM' USING ERRCODE = '22023';
  END CASE;

  -- Serialise attempts from one IP so a burst cannot slip past the counts.
  PERFORM pg_advisory_xact_lock(hashtext('antibot:' || p_form || ':' || p_ip_hash));

  -- One-time challenge: a second use is a replay.
  IF p_nonce IS NOT NULL AND EXISTS (SELECT 1 FROM public.antibot_events WHERE nonce = p_nonce) THEN
    v_verdict := 'block';
    v_reasons := array_append(v_reasons, 'replay');
    INSERT INTO public.antibot_events (form, ip_hash, email_hash, email_hint, nonce, verdict, score, reasons)
    VALUES (p_form, p_ip_hash, p_email_hash, p_email_hint, NULL, v_verdict, least(1000, greatest(0, p_score + 100)), v_reasons);
    RETURN jsonb_build_object('verdict', v_verdict, 'reasons', to_jsonb(v_reasons));
  END IF;

  IF v_verdict = 'allow' THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND ip_hash = p_ip_hash AND created_at > now() - v_ip_short_window;
    IF v_count >= v_ip_short THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_ip');
    END IF;
  END IF;

  IF v_verdict = 'allow' THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND ip_hash = p_ip_hash AND created_at > now() - interval '1 day';
    IF v_count >= v_ip_day THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_ip_day');
    END IF;
  END IF;

  IF v_verdict = 'allow' AND p_email_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND email_hash = p_email_hash AND created_at > now() - v_email_window;
    IF v_count >= v_email THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_email');
    END IF;
  END IF;

  IF v_verdict = 'allow' THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND verdict = 'allow' AND created_at > now() - interval '1 hour';
    IF v_count >= v_global THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_global');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.antibot_events (form, ip_hash, email_hash, email_hint, nonce, verdict, score, reasons)
    VALUES (p_form, p_ip_hash, p_email_hash, p_email_hint, p_nonce, v_verdict, least(1000, greatest(0, p_score)), v_reasons);
  EXCEPTION WHEN unique_violation THEN
    -- The same challenge used at the same moment from another IP.
    v_verdict := 'block';
    v_reasons := array_append(v_reasons, 'replay');
    INSERT INTO public.antibot_events (form, ip_hash, email_hash, email_hint, nonce, verdict, score, reasons)
    VALUES (p_form, p_ip_hash, p_email_hash, p_email_hint, NULL, v_verdict, least(1000, greatest(0, p_score + 100)), v_reasons);
  END;

  -- Keep 30 days; prune now and then rather than on every request.
  IF random() < 0.02 THEN
    DELETE FROM public.antibot_events WHERE created_at < now() - interval '30 days';
  END IF;

  RETURN jsonb_build_object('verdict', v_verdict, 'reasons', to_jsonb(v_reasons));
END;
$$;

REVOKE ALL ON FUNCTION public.antibot_gate(text, text, text, text, text, text, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.antibot_gate(text, text, text, text, text, text, integer, text[]) TO service_role;

-- How suspicious an IP has been in the last hour: the challenge gets harder.
CREATE OR REPLACE FUNCTION public.antibot_pressure(p_ip_hash text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::int FROM public.antibot_events
  WHERE ip_hash = p_ip_hash AND verdict <> 'allow' AND created_at > now() - interval '1 hour';
$$;

REVOKE ALL ON FUNCTION public.antibot_pressure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.antibot_pressure(text) TO service_role;

-- Admin view: totals by form and reason, plus the latest stopped attempts.
CREATE OR REPLACE FUNCTION public.admin_antibot_summary(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => least(30, greatest(1, p_days)));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'since', v_since,
    'totals', (
      SELECT coalesce(jsonb_object_agg(verdict, n), '{}'::jsonb)
      FROM (SELECT verdict, count(*) AS n FROM public.antibot_events WHERE created_at > v_since GROUP BY verdict) t
    ),
    'last_day', (
      SELECT coalesce(jsonb_object_agg(verdict, n), '{}'::jsonb)
      FROM (
        SELECT verdict, count(*) AS n FROM public.antibot_events
        WHERE created_at > now() - interval '1 day' GROUP BY verdict
      ) t
    ),
    'by_form', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('form', form, 'allow', a, 'stopped', s) ORDER BY form), '[]'::jsonb)
      FROM (
        SELECT form,
               count(*) FILTER (WHERE verdict = 'allow') AS a,
               count(*) FILTER (WHERE verdict <> 'allow') AS s
        FROM public.antibot_events WHERE created_at > v_since GROUP BY form
      ) t
    ),
    'by_reason', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (
        SELECT reason, count(*) AS n
        FROM public.antibot_events, unnest(reasons) AS reason
        WHERE created_at > v_since AND verdict <> 'allow'
        GROUP BY reason
      ) t
    ),
    'recent', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'form', form, 'verdict', verdict, 'score', score, 'reasons', reasons,
        'email_hint', email_hint, 'ip', left(ip_hash, 8), 'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.antibot_events
        WHERE verdict <> 'allow' AND created_at > v_since
        ORDER BY created_at DESC LIMIT 60
      ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_antibot_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_antibot_summary(integer) TO authenticated;
