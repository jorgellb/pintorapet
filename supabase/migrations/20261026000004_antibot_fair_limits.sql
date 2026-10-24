-- Fairer anti-bot limits.
-- 1. Only attempts that solved the challenge count towards the limits, so a
--    stranger cannot lock someone out by sending cheap, unsolved requests
--    with their email.
-- 2. Signing in is limited per email *and IP*; the per-email cap across all
--    IPs is much higher and only stops spread-out guessing.
-- 3. No global cap that turns everyone away: heavy traffic makes the proof of
--    work harder instead (antibot_pressure).

ALTER TABLE public.antibot_events
  ADD COLUMN IF NOT EXISTS solved boolean GENERATED ALWAYS AS (
    NOT (reasons && ARRAY[
      'honeypot', 'token_missing', 'token_invalid', 'token_form', 'token_expired',
      'too_fast', 'pow_missing', 'pow_invalid', 'replay'
    ]::text[])
  ) STORED;

CREATE INDEX IF NOT EXISTS antibot_events_allow_idx ON public.antibot_events (created_at DESC)
  WHERE verdict = 'allow';

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
  v_ip_short int; v_ip_short_window interval;
  v_ip_day int;
  -- per email (from this IP when signing in), and per email from any IP
  v_email int; v_email_any int; v_email_window interval;
  v_count int;
BEGIN
  IF p_verdict NOT IN ('allow', 'block') THEN
    RAISE EXCEPTION 'INVALID_VERDICT' USING ERRCODE = '22023';
  END IF;

  CASE p_form
    WHEN 'register' THEN
      v_ip_short := 3;  v_ip_short_window := interval '1 hour'; v_ip_day := 8;
      v_email := 3;     v_email_any := 3;  v_email_window := interval '1 day';
    WHEN 'sign_in' THEN
      v_ip_short := 20; v_ip_short_window := interval '15 minutes'; v_ip_day := 120;
      v_email := 8;     v_email_any := 50; v_email_window := interval '15 minutes';
    WHEN 'forgot' THEN
      v_ip_short := 5;  v_ip_short_window := interval '1 hour'; v_ip_day := 15;
      v_email := 3;     v_email_any := 3;  v_email_window := interval '1 hour';
    WHEN 'contact', 'commission' THEN
      v_ip_short := 5;  v_ip_short_window := interval '1 hour'; v_ip_day := 15;
      v_email := 5;     v_email_any := 5;  v_email_window := interval '1 day';
    ELSE
      RAISE EXCEPTION 'INVALID_FORM' USING ERRCODE = '22023';
  END CASE;

  PERFORM pg_advisory_xact_lock(hashtext('antibot:' || p_form || ':' || p_ip_hash));

  IF p_nonce IS NOT NULL AND EXISTS (SELECT 1 FROM public.antibot_events WHERE nonce = p_nonce) THEN
    v_verdict := 'block';
    v_reasons := array_append(v_reasons, 'replay');
    INSERT INTO public.antibot_events (form, ip_hash, email_hash, email_hint, nonce, verdict, score, reasons)
    VALUES (p_form, p_ip_hash, p_email_hash, p_email_hint, NULL, v_verdict, least(1000, greatest(0, p_score + 100)), v_reasons);
    RETURN jsonb_build_object('verdict', v_verdict, 'reasons', to_jsonb(v_reasons));
  END IF;

  IF v_verdict = 'allow' THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND ip_hash = p_ip_hash AND solved AND created_at > now() - v_ip_short_window;
    IF v_count >= v_ip_short THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_ip');
    END IF;
  END IF;

  IF v_verdict = 'allow' THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND ip_hash = p_ip_hash AND solved AND created_at > now() - interval '1 day';
    IF v_count >= v_ip_day THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_ip_day');
    END IF;
  END IF;

  IF v_verdict = 'allow' AND p_email_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND email_hash = p_email_hash AND solved AND created_at > now() - v_email_window
      AND (p_form <> 'sign_in' OR ip_hash = p_ip_hash);
    IF v_count >= v_email THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_email');
    END IF;
  END IF;

  IF v_verdict = 'allow' AND p_email_hash IS NOT NULL AND v_email_any > v_email THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND email_hash = p_email_hash AND solved AND created_at > now() - v_email_window;
    IF v_count >= v_email_any THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_email_spread');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.antibot_events (form, ip_hash, email_hash, email_hint, nonce, verdict, score, reasons)
    VALUES (p_form, p_ip_hash, p_email_hash, p_email_hint, p_nonce, v_verdict, least(1000, greatest(0, p_score)), v_reasons);
  EXCEPTION WHEN unique_violation THEN
    v_verdict := 'block';
    v_reasons := array_append(v_reasons, 'replay');
    INSERT INTO public.antibot_events (form, ip_hash, email_hash, email_hint, nonce, verdict, score, reasons)
    VALUES (p_form, p_ip_hash, p_email_hash, p_email_hint, NULL, v_verdict, least(1000, greatest(0, p_score + 100)), v_reasons);
  END;

  IF random() < 0.02 THEN
    DELETE FROM public.antibot_events WHERE created_at < now() - interval '30 days';
  END IF;

  RETURN jsonb_build_object('verdict', v_verdict, 'reasons', to_jsonb(v_reasons));
END;
$$;

-- How hard the next challenge should be: attempts stopped from this IP in the
-- last hour, plus a surcharge for everyone when the site is unusually busy.
CREATE OR REPLACE FUNCTION public.antibot_pressure(p_ip_hash text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT (
    SELECT count(*)::int FROM public.antibot_events
    WHERE ip_hash = p_ip_hash AND verdict <> 'allow' AND created_at > now() - interval '1 hour'
  ) + (
    SELECT CASE WHEN count(*) >= 300 THEN 3 WHEN count(*) >= 120 THEN 1 ELSE 0 END
    FROM public.antibot_events
    WHERE verdict = 'allow' AND created_at > now() - interval '1 hour'
  );
$$;
