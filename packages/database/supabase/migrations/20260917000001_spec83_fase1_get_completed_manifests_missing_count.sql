-- =============================================================================
-- spec-83 fase 1 — get_completed_manifests() gains missing_count
-- =============================================================================
-- "Cierres de hoy" (TodayClosuresPanel) shows "2 faltantes de 44" in the
-- warning palette on a closure that lost packages, per spec-54's deferred
-- item ("Los cierres no marcan faltantes") and spec-85's resolution (the
-- merma is a COUNT over public.discrepancies, not a new packages status).
--
-- missing_count = COUNT of this manifest's OWN open-or-resolved 'missing'
-- discrepancies (operation_type='pickup', not soft-deleted). Not filtered
-- by status: the panel shows what happened at close time, and resolving a
-- discrepancy later (spec-85's resolve_discrepancy) does not un-happen the
-- shortfall — it only means someone found the package afterwards. Excludes
-- kind='unexpected' — a foreign barcode found at scan time is a different
-- fact (surplus, not shortfall) and spec-54's "2 faltantes de 44" is
-- specifically about what did NOT show up.
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
         AND d.operator_id = m.operator_id
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
    ), 0)::INT AS missing_count
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Completed manifests for the history tab. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name. spec-83 fase 1: adds missing_count, a COUNT over public.discrepancies (kind=''missing'', operation_type=''pickup'', not soft-deleted, any status) for this manifest — TodayClosuresPanel uses it to show "N faltantes de M" in the warning palette only when > 0.';

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
