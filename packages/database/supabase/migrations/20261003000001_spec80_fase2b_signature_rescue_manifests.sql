-- =============================================================================
-- spec-80 fase 2b (ronda 3) — get_signature_rescue_manifests(): scoped rescue
-- =============================================================================
-- Ronda 2 sourced the mobile rescue banner from get_completed_manifests()
-- (operator-wide, no bound) purely to survive `trg_route_receptions_status_
-- sync` flipping the crew's own route to 'received' (B1, ronda 2). Ronda 3
-- review measured the actual cost of that lack of a bound: `signature_operator`
-- has only ever been written by `close_manifest` (20260913000002), so every
-- manifest completed BEFORE that migration — plausibly most of production's
-- history — has it NULL. 40 six-month-old closures showed up as red "FALTA
-- FIRMA" rows on the mobile landing screen in a real measurement, burying the
-- one that actually matters (yesterday's) under months of legacy noise. Worse:
-- every row is actionable — close_manifest only checks operator, not route/
-- crew membership — so any picker could sign a stranger's months-old load,
-- and that close records a 'missing' discrepancy per unscanned package,
-- feeding indemnity figures for a shortfall nobody can still investigate.
--
-- Two bounds, not one:
--   1. Ownership — only manifests whose route had THIS user as driver_id or
--      as pickup_route_crew (ever, not just currently: `pickup_route_crew.
--      removed_at` is stamped the moment the route stops being in_progress —
--      see 20260820000002 — so by the time a rescue exists, EVERY crew row on
--      that route already has removed_at set. Filtering on removed_at IS NULL
--      would then never match a closed route at all.). "Tus cargas", not "las
--      del operador" — this is the semantic bound.
--   2. A 30-day window on completed_at — belt-and-suspenders: even a picker
--      who genuinely was on some ancient route should not see it resurface.
--
-- Does NOT touch get_completed_manifests() (ronda 2, still used by desktop's
-- Completados tab and mobile's closures.length header stat) — that RPC is
-- deliberately operator-wide and unbounded, which is correct for a history
-- tab a manager might search. A NEW function instead of narrowing that one,
-- so desktop's contract does not change.
--
-- "driver OR crew" pattern and the me-CTE copied from get_my_active_pickup_
-- route (20260820000005) — the one existing RPC that already answers "is
-- this user on this route" — with removed_at deliberately dropped (see
-- above) since that RPC asks "on it NOW", this one asks "was ever on it".
--
-- SECURITY INVOKER: every table this reads already has a tenant-scoped
-- SELECT policy for authenticated users (manifests, pickup_routes,
-- pickup_route_crew, users, discrepancies) — RLS is the real backstop here,
-- same reasoning as 20260820000005's header comment.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_signature_rescue_manifests()
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
  missing_count          INT,
  signature_operator     TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, auth
AS $$
  WITH me AS (
    SELECT NULLIF(auth.jwt() ->> 'sub','')::UUID AS uid,
           public.get_operator_id()              AS op
  )
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
      SELECT COUNT(DISTINCT d.package_id)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         -- Defense in depth, not load-bearing on its own: d.manifest_id
         -- already FKs to a manifests row that the outer WHERE has scoped
         -- to me.op, so a cross-operator d row could only reach here via a
         -- manifest that isn't this operator's in the first place — which
         -- the outer clause already excludes. No fixture kills this line
         -- alone; it stays for the same reason the rest of this repo
         -- re-checks tenant scope on every join.
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
    ), 0)::INT AS missing_count,
    m.signature_operator
  FROM manifests m
  CROSS JOIN me
  JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = me.op
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
    AND m.signature_operator IS NULL
    AND m.completed_at >= NOW() - INTERVAL '30 days'
    AND (
      pr.driver_id = me.uid
      OR EXISTS (
        SELECT 1 FROM public.pickup_route_crew c
         WHERE c.pickup_route_id = pr.id
           AND c.user_id = me.uid
           AND c.deleted_at IS NULL
      )
    )
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_signature_rescue_manifests() IS 'spec-80 fase 2b (ronda 3) — manifests THIS user''s route had them driving or on crew for, completed WITHOUT a signature (trg_route_receptions_status_sync closed it without ever reaching Firma), within the last 30 days. Bounded on purpose: signature_operator has only ever been written by close_manifest (20260913000002), so unbounded this would surface the operator''s ENTIRE unsigned history, most of it irrecoverable legacy noise burying the one closure that actually needs today''s attention. Ownership uses driver_id OR pickup_route_crew membership WITHOUT removed_at IS NULL (that column is stamped the moment the route leaves in_progress, so requiring it NULL would never match a closed route).';

REVOKE ALL ON FUNCTION public.get_signature_rescue_manifests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signature_rescue_manifests() TO authenticated;
REVOKE ALL ON FUNCTION public.get_signature_rescue_manifests() FROM anon;

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_signature_rescue_manifests'
  ) THEN
    RAISE EXCEPTION 'get_signature_rescue_manifests not created';
  END IF;

  RAISE NOTICE '✓ spec-80 fase 2b ronda 3 get_signature_rescue_manifests migration complete';
END $$;

COMMIT;
