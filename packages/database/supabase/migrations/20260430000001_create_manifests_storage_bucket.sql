-- Migration: Create `manifests` storage bucket for OCR camera intake (spec-23)
-- Date: 2026-04-30
--
-- Background: spec-23 hard-coded `storage.from('manifests')` in both the
-- frontend uploader (apps/frontend/src/hooks/pickup/useCameraIntake.ts) and
-- the intake agent (apps/agents/src/agents/intake/intake-agent.ts), but the
-- bucket was never provisioned. Production uploads were failing with
-- "Bucket not found".
--
-- Storage paths are shaped: `<operator_id>/<pickup_point_id>/<ts>/page-N.jpg`
-- so RLS scopes on the first folder segment matching get_operator_id().

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'manifests',
  'manifests',
  false,
  10485760, -- 10 MiB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "manifests_select_own_operator" ON storage.objects;
DROP POLICY IF EXISTS "manifests_insert_own_operator" ON storage.objects;
DROP POLICY IF EXISTS "manifests_update_own_operator" ON storage.objects;
DROP POLICY IF EXISTS "manifests_delete_own_operator" ON storage.objects;

CREATE POLICY "manifests_select_own_operator"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'manifests'
    AND (storage.foldername(name))[1]::uuid = public.get_operator_id()
  );

CREATE POLICY "manifests_insert_own_operator"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'manifests'
    AND (storage.foldername(name))[1]::uuid = public.get_operator_id()
  );

CREATE POLICY "manifests_update_own_operator"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'manifests'
    AND (storage.foldername(name))[1]::uuid = public.get_operator_id()
  )
  WITH CHECK (
    bucket_id = 'manifests'
    AND (storage.foldername(name))[1]::uuid = public.get_operator_id()
  );

CREATE POLICY "manifests_delete_own_operator"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'manifests'
    AND (storage.foldername(name))[1]::uuid = public.get_operator_id()
  );

-- Note: the service_role key bypasses RLS, so the intake agent worker
-- (apps/agents) can download any object regardless of operator_id. That is
-- intentional — the worker runs out-of-band and is trusted infrastructure.
