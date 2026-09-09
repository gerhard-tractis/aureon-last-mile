-- =============================================================================
-- spec-83 fase 1 — get_completed_manifests() gains missing_count
-- =============================================================================
-- "Cierres de hoy" (TodayClosuresPanel) shows "2 faltantes de 44" in the
-- warning palette on a closure that lost packages, per spec-54's deferred
-- item ("Los cierres no marcan faltantes") and spec-85's resolution (the
-- merma is a COUNT over public.discrepancies, not a new packages status).
--
-- missing_count = COUNT of this manifest's 'missing' discrepancies
-- (operation_type='pickup', not soft-deleted, status <> 'resolved').
--
-- Product decision (2026-09-08, round 2 review of this phase): "if it was
-- resolved, it is no longer merma" — status='resolved' is excluded.
-- status='lost' is NOT excluded: per 20260913000005's own comment, 'lost'
-- is the trigger for a future indemnity workflow restricted to
-- operations_manager, not a statement that the shortfall stopped existing.
-- Filtering on `= 'open'` instead (the first draft of this migration) would
-- have made the panel go GREEN the moment an ops manager marks a real loss
-- as 'lost' — the worst possible outcome painted as a clean close. Excludes
-- kind='unexpected' — a foreign barcode found at scan time is a different
-- fact (surplus, not shortfall) and spec-54's "2 faltantes de 44" is
-- specifically about what did NOT show up.
--
-- Known limitation, accepted rather than fixed here: this COUNTs rows, not
-- DISTINCT package_id. uniq_open_discrepancy_per_package
-- (20260913000001) only blocks two 'open' rows for the same
-- (package_id, source_id) — it does NOT block an 'open' row coexisting with
-- a 'lost' or already-'resolved' row for that same package on the same
-- manifest. That combination is rare (it requires two separate
-- record_discrepancies calls against the same still-open manifest) but not
-- impossible, and would inflate missing_count by counting the same physical
-- shortfall twice. Covered, not silently ignored, by this phase's pgTAP
-- (see the CARGA-83-4 fixture).
--
-- Template (per CLAUDE.md, latest definition of get_completed_manifests as
-- of 2026-09-08, verified with
-- `git grep -l get_completed_manifests packages/database/supabase/migrations/`
-- — the literal 20260428000001 instruction in this spec's own text would
-- have been the trap: 20260813000001 (spec-53) is newer and added
-- labels_printed_at/labels_printed_by_name, which this migration must not
-- drop):
--   get_completed_manifests → 20260813000001_spec53_package_labels.sql
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_completed_manifests();

CREATE OR REPLACE FUNCTION public.get_completed_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  missing_count          INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.completed_at,
    m.created_at,
    m.pickup_location as pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name,
    COALESCE((
      SELECT COUNT(*)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         -- Defense in depth, not load-bearing on its own: d.manifest_id
         -- already FKs to a manifests row that the outer WHERE has scoped
         -- to public.get_operator_id(), so a cross-operator d row could
         -- only reach here via a manifest that isn't this operator's in the
         -- first place — which the outer clause already excludes. No
         -- fixture kills this line alone; it stays for the same reason the
         -- rest of this repo re-checks tenant scope on every join.
         AND d.operator_id = m.operator_id
         -- Redundant by discrepancy_source_matches_operation (20260913000001):
         -- that CHECK forces operation_type='reception' rows to have
         -- manifest_id IS NULL, so d.manifest_id = m.id above already
         -- implies operation_type='pickup'. Kept for readability, not as a
         -- second guard — do not go looking for a fixture that kills this
         -- clause alone.
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Completed manifests for the history tab. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name. spec-83 fase 1: adds missing_count, a COUNT over public.discrepancies (kind=''missing'', operation_type=''pickup'', not soft-deleted, status <> ''resolved'' — ''lost'' still counts, only ''resolved'' means the shortfall is no longer merma) for this manifest — TodayClosuresPanel uses it to show "N faltantes de M" in the warning palette only when > 0. Counts rows, not DISTINCT package_id — see the comment above the subquery for the accepted double-count edge case.';

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_completed_manifests'
  ) THEN
    RAISE EXCEPTION 'get_completed_manifests not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_completed_manifests'
       AND pg_get_function_result(p.oid) ILIKE '%missing_count integer%'
  ) THEN
    RAISE EXCEPTION 'get_completed_manifests missing_count column not found';
  END IF;

  RAISE NOTICE '✓ spec-83 fase 1 get_completed_manifests missing_count migration complete';
END $$;

COMMIT;
