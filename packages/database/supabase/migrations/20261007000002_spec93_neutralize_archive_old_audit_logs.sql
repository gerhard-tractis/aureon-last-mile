-- =============================================================================
-- spec-93 — neutralize archive_old_audit_logs() and unschedule its cron job.
-- =============================================================================
-- User decision, made explicitly (option 1 of three presented), matching
-- what REMEDIATION.md H3 already recommended: "Neuter archive_old_audit_logs()
-- (RAISE EXCEPTION 'export not implemented') until export-before-delete
-- exists; confirm it is not scheduled in pg_cron."
--
-- The problem, measured: archive_old_audit_logs() (defined in
-- 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql:
-- 287-330, and never redefined by any later migration — checked with
-- `git grep -ln archive_old_audit_logs -- packages/database/supabase/
-- migrations/`, which returns only that file and
-- 20260913000006_spec88_fase1_revoke_anon.sql, and the latter touches only
-- GRANT/REVOKE, never CREATE OR REPLACE, so the body below is still the one
-- currently live) does `DELETE FROM public.audit_logs WHERE timestamp <
-- v_cutoff_date` with a TODO where an S3 export should be, against a stated
-- 7-year Chilean audit retention requirement. That export was never built.
--
-- The same migration left its own `cron.schedule(...)` call commented out
-- (20260217000001:333-335) — but apps/frontend/setup-cron-job.js, a manual
-- script that ran outside the migration pipeline, scheduled it against
-- production anyway, under the job name `archive_old_audit_logs` (note:
-- the commented-out call in 20260217000001 used `archive_audit_logs`,
-- without "old" — the two names differ, and only the "old" one is what
-- spec-93 actually measured running in production, CI run 34539233402,
-- schedule `0 2 * * *`, active=true).
--
-- Severity, measured and not inflated: the predicate is `timestamp <
-- CURRENT_DATE - INTERVAL '7 years'`. This system's audit data starts
-- around 2026-02, so as of this migration (2026-09) zero rows qualify —
-- the job has been running nightly and deleting nothing. The risk was
-- ARMED, not REALIZED. There is no data loss to recover from.
--
-- A note on an inherited claim: 20260913000006_spec88_fase1_revoke_anon.sql
-- (lines ~28-30) says of this same function: "su cron está comentado
-- (20260217000001:335) — nadie llama esto por PostgREST hoy". The second
-- half (nobody calls it via PostgREST) still holds — this migration does
-- not touch the REVOKEs spec-88 fase 1 applied, and does not need to. But
-- the first half ("su cron está comentado") is FALSE in production: the
-- job was, and until this migration runs, is actively scheduled via
-- setup-cron-job.js, outside the migration pipeline the comment was
-- describing. That inherited assumption was never re-verified against
-- production before being written down — this migration is where it gets
-- corrected. The REVOKE conclusion in 20260913000006 does not change.
--
-- Do not add any GRANT here. spec-88 fase 1 closed this function to
-- PUBLIC, anon, AND authenticated on purpose; CREATE OR REPLACE preserves
-- existing grants, so simply not adding a GRANT statement is sufficient to
-- not undo that work.
-- =============================================================================

-- 1. Neutralize the function body. SECURITY DEFINER preserved (matches the
--    live definition in 20260217000001); no SET search_path was present on
--    the live definition either, so none is added here.
CREATE OR REPLACE FUNCTION public.archive_old_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION 'archive_old_audit_logs() is disabled: it deleted audit_logs rows past the 7-year Chilean retention cutoff with no export-before-delete step (S3 export was never implemented, see the TODO left in 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql). Disabled intentionally per REMEDIATION.md H3 and docs/specs/spec-93-paridad-qa-produccion.md. Do not re-enable until an export-before-delete path exists.';
END;
$$;

COMMENT ON FUNCTION public.archive_old_audit_logs IS 'spec-93: disabled — see REMEDIATION.md H3. Raises instead of deleting audit_logs rows; pre-delete S3 export was never implemented.';

-- 2. Unschedule the production cron job by the name actually measured
--    running (`archive_old_audit_logs`, not the commented-out
--    `archive_audit_logs`). Idempotent: a no-op in QA and in this test
--    harness, where the job was never scheduled via a migration in the
--    first place.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive_old_audit_logs') THEN
      PERFORM cron.unschedule('archive_old_audit_logs');
    END IF;
  END IF;
END $$;
