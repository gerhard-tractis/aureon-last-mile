-- Migration: Create `raw-files` storage bucket (spec-93 fase 3b)
-- Date: 2026-10-07
--
-- Background: `raw-files` has existed in production storage since Story 2.3
-- (packages/database/supabase/migrations/20260223000001_create_automation_
-- worker_schema.sql:250 references it as already created), but no migration
-- ever provisioned it — it was created directly against production, the
-- same class of gap #758 found for the `manifests` bucket
-- (20260430000001_create_manifests_storage_bucket.sql). spec-93 fase 4's
-- parity guardrail (run 34545563792) caught the resulting QA/production
-- divergence: the bucket is present in production and absent in QA.
--
-- `public.raw_files.storage_path` documents the layout as
-- `{operator_slug}/{client_slug}/{date}/{filename}` (not `{operator_id}/...`
-- like `manifests`), and every writer found in the repo
-- (apps/worker/n8n/workflows/beetrack-excel-import.json,
-- easy-wms-webhook.json, paris-dispatchtrack-webhook.json) uploads with the
-- Supabase SERVICE ROLE key, which bypasses RLS entirely.
--
-- Unlike `manifests` (20260430000001_create_manifests_storage_bucket.sql),
-- which DOES define four storage.objects policies scoped to
-- `(storage.foldername(name))[1]::uuid = public.get_operator_id()` — no
-- storage.objects policy is added here because there is no authenticated-
-- user path into this bucket to scope: the path uses slugs, not
-- `operator_id`, and the only writers are the n8n workflows above, all
-- using the service role, which never evaluates RLS in the first place.
--
-- Configuration mirrors what fase 4 measured in production (run
-- 34545563792): public=false, no file_size_limit, no allowed_mime_types
-- restriction — the automation worker ingests whatever raw format each
-- carrier sends (xlsx, csv, json).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'raw-files',
  'raw-files',
  false,
  NULL,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
