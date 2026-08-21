-- Migration: restore the tenant guard on get_active_routes_with_dispatches
--
-- WHAT WAS WRONG
-- On QA, this function was running its PRE-FIX body: LANGUAGE sql, no
-- SET search_path, and no PERFORM public.assert_operator_access(...) — i.e.
-- the definition from 20260310000004, not the guarded one from
-- 20260729000001. Because it is SECURITY DEFINER and EXECUTE is granted to
-- `authenticated`, any logged-in user could read another tenant's routes and
-- dispatches by passing that tenant's operator_id. That is the exact leak
-- 20260729000001 was written to close, and it was open again.
--
-- cross_tenant_definer_rpcs_test.sql has been failing on every QA deploy with
-- "TEST 2 FAIL: cross-tenant call was allowed — the leak is back". The
-- detection worked; nothing acted on it.
--
-- HOW IT REVERTED — stated honestly, because it matters for prevention
-- Both 20260310000004 and 20260729000001 are recorded in
-- supabase_migrations.schema_migrations, and apply-migrations.sh skips any
-- recorded version, so the pipeline cannot have re-applied the older file.
-- get_unmatched_comunas — fixed by the SAME migration — still carries its
-- guard, so 20260729000001 did run to completion. Something re-applied
-- 20260310000004 alone, afterwards, outside the pipeline: a manual `psql -f`
-- of that file, or a restore. The available evidence does not say which, and
-- this header does not guess.
--
-- WHY A NEW MIGRATION RATHER THAN EDITING THE OLD ONE
-- 20260729000001 is already recorded as applied, so editing it changes
-- nothing on any environment that has it. A new version is the only thing
-- that runs.
--
-- Templated from 20260729000001 — the latest definition — per CLAUDE.md.
-- The body below is byte-identical to that file's; only this header is new.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_active_routes_with_dispatches(
  p_operator_id UUID,
  p_route_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_operator_access(p_operator_id);

  RETURN (
    SELECT COALESCE(jsonb_agg(route_data ORDER BY route_data->>'start_time'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', r.id,
        'external_route_id', r.external_route_id,
        'driver_name', r.driver_name,
        'vehicle_id', r.vehicle_id,
        'status', r.status,
        'start_time', r.start_time,
        'total_stops', (
          SELECT COUNT(*)
          FROM dispatches d
          WHERE d.route_id = r.id AND d.deleted_at IS NULL
        ),
        'completed_stops', (
          SELECT COUNT(*)
          FROM dispatches d
          WHERE d.route_id = r.id
            AND d.status IN ('delivered', 'failed', 'partial')
            AND d.deleted_at IS NULL
        ),
        'dispatches', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', d.id,
                'external_dispatch_id', d.external_dispatch_id,
                'order_id', d.order_id,
                'status', d.status,
                'planned_sequence', d.planned_sequence,
                'estimated_at', d.estimated_at,
                'arrived_at', d.arrived_at,
                'completed_at', d.completed_at,
                'latitude', d.latitude,
                'longitude', d.longitude,
                'failure_reason', d.failure_reason
              ) ORDER BY d.planned_sequence NULLS LAST
            ),
            '[]'::jsonb
          )
          FROM dispatches d
          WHERE d.route_id = r.id AND d.deleted_at IS NULL
        )
      ) AS route_data
      FROM routes r
      WHERE r.operator_id = p_operator_id
        AND r.route_date = p_route_date
        AND r.deleted_at IS NULL
      ORDER BY r.start_time
    ) sub
  );
END;
$$;

COMMENT ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) IS
  'Returns all routes with their dispatches for a given operator and date. Used by live route tracking UI. Rejects a p_operator_id that is not the caller''s own (restored 2026-08-21).';

-- =============================================================================
-- Validation — one-time, proving THIS migration installed what it claims
-- =============================================================================
-- A DO block runs once, when this file applies. It cannot catch a future
-- reversion; cross_tenant_definer_rpcs_test.sql and the new
-- definer_rpc_tenant_guards.sql are what do that, on every QA deploy.
DO $validate$
DECLARE
  v_src  TEXT;
  v_lang TEXT;
BEGIN
  SELECT p.prosrc, l.lanname INTO v_src, v_lang
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language  l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.proname = 'get_active_routes_with_dispatches';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_active_routes_with_dispatches is missing after this migration';
  END IF;
  IF v_src NOT LIKE '%assert_operator_access%' THEN
    RAISE EXCEPTION 'get_active_routes_with_dispatches still has no tenant guard';
  END IF;
  IF v_lang <> 'plpgsql' THEN
    RAISE EXCEPTION 'get_active_routes_with_dispatches is LANGUAGE % — the pre-fix body is sql', v_lang;
  END IF;

  RAISE NOTICE 'tenant guard restored on get_active_routes_with_dispatches';
END $validate$;

COMMIT;
