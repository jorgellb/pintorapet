-- Photos of the pet with a commission request (encargos): up to ten, private.
--
-- Sending the form returns a one-time upload key, kept here as a hash for two
-- hours; each photo is uploaded with it to Cloudinary as an authenticated
-- (non-public) image and recorded in commission_files. Only the admin sees
-- them, through short-lived signed links.

ALTER TABLE public.commission_requests ADD COLUMN IF NOT EXISTS upload_token_hash text;
ALTER TABLE public.commission_requests ADD COLUMN IF NOT EXISTS upload_until timestamptz;

ALTER TABLE public.commission_files ADD COLUMN IF NOT EXISTS storage_public_id text;
CREATE UNIQUE INDEX IF NOT EXISTS commission_files_storage_unique
  ON public.commission_files (storage_public_id) WHERE storage_public_id IS NOT NULL;
