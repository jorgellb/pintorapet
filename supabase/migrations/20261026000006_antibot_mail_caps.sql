-- Follow-up to 20261026000004/5, after weighing lock-outs against abuse:
-- - limits count only attempts that went through (verdict 'allow'), so
--   neither unsolved nor already rate-limited attempts extend a lock-out;
-- - signing in: at most 20 attempts per account every 15 minutes across all
--   IPs (was 50), 8 from one IP; no site-wide cap, heavy traffic raises the
--   proof of work instead (antibot_pressure);
-- - register and password links: no site-wide cap here; Supabase Auth's
--   hourly email limit already plays that part;
-- - contact and commissions only email Meili. Past an hourly site-wide
--   count the message is still saved and queued, but the immediate email is
--   skipped ('mail_deferred'): the daily outbox cron sends it. Nobody is
--   turned away and a flood cannot burn the mail quota.

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
  -- messages emailed straight away per hour, all visitors together
  v_mail_now int;
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
      v_email := 8;     v_email_any := 20; v_email_window := interval '15 minutes';
    WHEN 'forgot' THEN
      v_ip_short := 5;  v_ip_short_window := interval '1 hour'; v_ip_day := 15;
      v_email := 3;     v_email_any := 3;  v_email_window := interval '1 hour';
    WHEN 'contact', 'commission' THEN
      v_ip_short := 5;  v_ip_short_window := interval '1 hour'; v_ip_day := 15;
      v_email := 5;     v_email_any := 5;  v_email_window := interval '1 day';
      v_mail_now := 30;
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
    WHERE form = p_form AND ip_hash = p_ip_hash AND verdict = 'allow' AND created_at > now() - v_ip_short_window;
    IF v_count >= v_ip_short THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_ip');
    END IF;
  END IF;

  IF v_verdict = 'allow' THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND ip_hash = p_ip_hash AND verdict = 'allow' AND created_at > now() - interval '1 day';
    IF v_count >= v_ip_day THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_ip_day');
    END IF;
  END IF;

  IF v_verdict = 'allow' AND p_email_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND email_hash = p_email_hash AND verdict = 'allow' AND created_at > now() - v_email_window
      AND (p_form <> 'sign_in' OR ip_hash = p_ip_hash);
    IF v_count >= v_email THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_email');
    END IF;
  END IF;

  IF v_verdict = 'allow' AND p_email_hash IS NOT NULL AND v_email_any > v_email THEN
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND email_hash = p_email_hash AND verdict = 'allow' AND created_at > now() - v_email_window;
    IF v_count >= v_email_any THEN
      v_verdict := 'rate'; v_reasons := array_append(v_reasons, 'rate_email_spread');
    END IF;
  END IF;

  -- Contact and commissions: past the hourly count, keep the message but let
  -- the daily outbox send the email. One lock per form keeps the count exact.
  IF v_verdict = 'allow' AND v_mail_now IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('antibot:mail:' || p_form));
    SELECT count(*) INTO v_count FROM public.antibot_events
    WHERE form = p_form AND verdict = 'allow' AND NOT ('mail_deferred' = ANY (reasons))
      AND created_at > now() - interval '1 hour';
    IF v_count >= v_mail_now THEN
      v_reasons := array_append(v_reasons, 'mail_deferred');
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


-- Every limit now counts verdict = 'allow'; the helper column is unused.
DROP INDEX IF EXISTS public.antibot_events_allow_idx;
ALTER TABLE public.antibot_events DROP COLUMN IF EXISTS solved;
CREATE INDEX IF NOT EXISTS antibot_events_allow_idx ON public.antibot_events (created_at DESC)
  WHERE verdict = 'allow';
