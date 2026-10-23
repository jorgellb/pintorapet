-- Public catalog/portfolio buckets + private commission uploads.
-- Policies: public read on public buckets; write only for admins.
-- Commission files: no public read.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'catalog-public',
    'catalog-public',
    true,
    15728640,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'portfolio-public',
    'portfolio-public',
    true,
    20971520,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'commission-private',
    'commission-private',
    false,
    15728640,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
  )
ON CONFLICT (id) DO NOTHING;

-- Public read for public buckets
CREATE POLICY catalog_public_read
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'catalog-public');

CREATE POLICY portfolio_public_read
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'portfolio-public');

-- Admin write on public buckets
CREATE POLICY catalog_admin_write
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'catalog-public' AND public.is_admin());

CREATE POLICY catalog_admin_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'catalog-public' AND public.is_admin())
  WITH CHECK (bucket_id = 'catalog-public' AND public.is_admin());

CREATE POLICY catalog_admin_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'catalog-public' AND public.is_admin());

CREATE POLICY portfolio_admin_write
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'portfolio-public' AND public.is_admin());

CREATE POLICY portfolio_admin_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'portfolio-public' AND public.is_admin())
  WITH CHECK (bucket_id = 'portfolio-public' AND public.is_admin());

CREATE POLICY portfolio_admin_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'portfolio-public' AND public.is_admin());

-- Commission private: admin full; no anon access
CREATE POLICY commission_admin_select
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'commission-private' AND public.is_admin());

CREATE POLICY commission_admin_write
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'commission-private' AND public.is_admin());

CREATE POLICY commission_admin_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'commission-private' AND public.is_admin())
  WITH CHECK (bucket_id = 'commission-private' AND public.is_admin());

CREATE POLICY commission_admin_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'commission-private' AND public.is_admin());
