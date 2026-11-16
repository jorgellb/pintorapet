-- What Supabase provided around our migrations, recreated on a plain
-- PostgreSQL (Aiven) so supabase/migrations/*.sql apply unchanged.
-- Idempotent: safe to run again. Run as the database owner (avnadmin).

-- Roles PostgREST used. The app switches to anon/authenticated inside a
-- transaction (SET LOCAL ROLE) so RLS policies and grants keep applying.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;
GRANT anon, authenticated, service_role TO CURRENT_USER;

-- Extensions live in their own schema, as on Supabase (functions name it in
-- their search_path).
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = "$user", public, extensions', current_database());
END
$$;
SET search_path = "$user", public, extensions;

-- Supabase's default privileges on public: everything for the three roles,
-- narrowed by RLS and by the REVOKEs in the migrations.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth: Better Auth's tables (users, session, account, verification), plus the
-- Supabase columns and helpers the migrations read.
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Supabase columns read by admin/customer functions; kept in step below.
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS auth.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON auth.session (user_id);

CREATE TABLE IF NOT EXISTS auth.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON auth.account (user_id);

CREATE TABLE IF NOT EXISTS auth.verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON auth.verification (identifier);

-- Only the owner (the app's service connection and SECURITY DEFINER
-- functions) touches the auth tables.
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC, anon, authenticated, service_role;

-- Keep the Supabase columns in step with Better Auth's.
CREATE OR REPLACE FUNCTION auth.sync_supabase_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.email_verified AND NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  ELSIF NOT NEW.email_verified THEN
    NEW.email_confirmed_at := NULL;
  END IF;
  IF coalesce(NEW.raw_user_meta_data->>'full_name', '') IS DISTINCT FROM NEW.name THEN
    NEW.raw_user_meta_data := coalesce(NEW.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', NEW.name);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS users_sync_supabase_columns ON auth.users;
CREATE TRIGGER users_sync_supabase_columns
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auth.sync_supabase_columns();

CREATE OR REPLACE FUNCTION auth.touch_last_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE auth.users SET last_sign_in_at = NEW.created_at WHERE id = NEW.user_id;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS session_touch_last_sign_in ON auth.session;
CREATE TRIGGER session_touch_last_sign_in
  AFTER INSERT ON auth.session
  FOR EACH ROW EXECUTE FUNCTION auth.touch_last_sign_in();

-- Same definitions as Supabase: the claims come from the transaction
-- (set_config('request.jwt.claims', ..., true)).
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage: just enough for the old bucket migration and its policies. Media
-- now lives in Cloudinary; nothing reads these.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- vault: same functions and view as Supabase Vault, encrypted with pgcrypto.
-- The key is never stored: the app sets app.vault_key for the transaction
-- that needs a secret (set_config(..., true)). Without it secrets stay sealed.
CREATE SCHEMA IF NOT EXISTS vault;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION vault.key()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_key text := nullif(current_setting('app.vault_key', true), '');
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'vault key not set for this transaction' USING ERRCODE = '28000';
  END IF;
  RETURN v_key;
END
$$;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text,
  new_name text DEFAULT NULL,
  new_description text DEFAULT '',
  new_key_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SET search_path = pg_catalog, extensions
AS $$
  INSERT INTO vault.secrets (name, description, secret)
  VALUES (new_name, coalesce(new_description, ''), encode(pgp_sym_encrypt(new_secret, vault.key()), 'base64'))
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id uuid,
  new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL,
  new_key_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, extensions
AS $$
  UPDATE vault.secrets SET
    secret = CASE WHEN new_secret IS NULL THEN secret
                  ELSE encode(pgp_sym_encrypt(new_secret, vault.key()), 'base64') END,
    name = coalesce(new_name, name),
    description = coalesce(new_description, description),
    updated_at = now()
  WHERE id = secret_id
$$;

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT
  s.id,
  s.name,
  s.description,
  s.secret,
  extensions.pgp_sym_decrypt(decode(s.secret, 'base64'), vault.key()) AS decrypted_secret,
  s.created_at,
  s.updated_at
FROM vault.secrets s;

REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Which supabase/migrations files have been applied here.
CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ops.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
