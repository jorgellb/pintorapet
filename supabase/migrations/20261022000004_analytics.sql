-- First-party visit log. No IP address, no name, no raw user agent.
-- The session hash only groups pages opened in the same browser tab.

CREATE TABLE public.page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  session_hash text NOT NULL,
  path text NOT NULL,
  locale text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country text,
  region text,
  device text,
  browser text,
  os text,
  language text,
  viewport text,
  CONSTRAINT page_views_path_length CHECK (char_length(path) BETWEEN 1 AND 300),
  CONSTRAINT page_views_session_length CHECK (char_length(session_hash) BETWEEN 16 AND 128)
);

CREATE INDEX page_views_viewed_at_idx ON public.page_views (viewed_at DESC);
CREATE INDEX page_views_path_idx ON public.page_views (path);

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY page_views_admin_select
  ON public.page_views
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DO $$
DECLARE
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  REVOKE ALL ON TABLE public.page_views FROM PUBLIC;
  IF has_anon THEN
    REVOKE ALL ON TABLE public.page_views FROM anon;
  END IF;
  IF has_auth THEN
    REVOKE ALL ON TABLE public.page_views FROM authenticated;
    GRANT SELECT ON TABLE public.page_views TO authenticated;
  END IF;
END;
$$;

COMMENT ON TABLE public.page_views IS
  'Anonymous first-party page views. No IP, no account, no advertising identifiers.';
