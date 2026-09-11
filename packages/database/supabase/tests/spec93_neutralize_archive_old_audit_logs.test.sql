-- pgTAP: spec-93 — neutralize archive_old_audit_logs() and unschedule its
-- production cron job.
--
-- Context (measured, not assumed — see docs/specs/spec-93-paridad-qa-produccion.md
-- and REMEDIATION.md H3): archive_old_audit_logs() DELETEs rows past a
-- 7-year retention cutoff with a TODO where an S3 export should be. That
-- export was never built. The migration that created the function
-- (20260217000001) left its `cron.schedule(...)` call commented out, but
-- apps/frontend/setup-cron-job.js scheduled it against production anyway,
-- under the job name `archive_old_audit_logs` (note: NOT `archive_audit_logs`,
-- the name used in the commented-out call in 20260217000001 — the two
-- differ by the word "old", and only the "old" name is the one that was
-- actually found running in production, run 34539233402).
--
-- This test proves two things:
--   1. Calling the function now raises, instead of silently deleting.
--   2. No cron.job row named 'archive_old_audit_logs' survives, regardless
--      of whether it existed before this migration ran.

BEGIN;
SELECT plan(2);

-- 1. The function must refuse to run at all now.
SELECT throws_ok(
  'SELECT public.archive_old_audit_logs()',
  'P0001',
  NULL,
  'archive_old_audit_logs() raises instead of deleting audit_logs rows'
);

-- 2. No cron.job with this name may exist after the migration.
SELECT is(
  (SELECT COUNT(*)::int FROM cron.job WHERE jobname = 'archive_old_audit_logs'),
  0,
  'no cron.job named archive_old_audit_logs survives'
);

SELECT * FROM finish();
ROLLBACK;
