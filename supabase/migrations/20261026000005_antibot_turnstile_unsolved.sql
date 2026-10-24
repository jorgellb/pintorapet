-- Attempts stopped by Turnstile did not solve the challenge either: they must
-- not count towards anyone's limits (see 20261026000004).

DROP INDEX IF EXISTS public.antibot_events_allow_idx;
ALTER TABLE public.antibot_events DROP COLUMN IF EXISTS solved;
ALTER TABLE public.antibot_events
  ADD COLUMN solved boolean GENERATED ALWAYS AS (
    NOT (reasons && ARRAY[
      'honeypot', 'token_missing', 'token_invalid', 'token_form', 'token_expired',
      'too_fast', 'pow_missing', 'pow_invalid', 'replay',
      'turnstile', 'turnstile_missing', 'turnstile_action'
    ]::text[])
  ) STORED;
CREATE INDEX IF NOT EXISTS antibot_events_allow_idx ON public.antibot_events (created_at DESC)
  WHERE verdict = 'allow';
