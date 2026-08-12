-- =============================================================================
-- spec-52 Task 4 — reconcile abandoned pickup routes
-- =============================================================================
-- DATA-ONLY. Deliberately a separate migration from Task 3's schema change
-- (20260812000003) so the two can be reasoned about, and reverted,
-- independently: rolling back a bad row edit must not mean rolling back
-- vehicle_id.
--
-- THE SITUATION (production, project wfwlcpnkkxxzdvhvvsxb, 2026-08-11):
-- PR-2026-0001 has sat in status 'in_progress' since 2026-07-30 — the driver
-- drove, delivered, and never closed the route. Because
-- uniq_pickup_routes_one_active_per_driver allows one in_progress route per
-- driver, that stale row has blocked its driver from starting ANY route since.
-- The route is not going to be closed by anyone; it has to be cancelled.
--
-- WHAT IS DELIBERATELY LEFT ALONE:
--   * in_transit routes (PR-LEGACY-000006/000007). The truck arrived; a
--     receptionist can still complete them through the normal reception flow.
--     They also do not block their driver — the uniqueness index only covers
--     'in_progress'. Cancelling them would destroy recoverable work.
--   * received routes (PR-LEGACY-000001..000005). Terminal.
--   * package statuses. Reconstructing per-package transition timestamps from
--     scan history would fabricate data we do not have. The spec-52 state
--     engine (Task 2) starts clean from here forward, and its forward-only
--     guard makes the first real scan on any of these packages safe.
--
-- KEYED ON DATA, NEVER ON IDS. Not one statement below names a route id or a
-- route code. Production row ids do not exist in a fresh database, so an
-- id-keyed statement would be a silent no-op locally and therefore untestable.
-- Every write is guarded by the predicate that DEFINES an abandoned route:
--   status = 'in_progress' AND started_at < cutoff AND deleted_at IS NULL.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — The reconciliation, as a callable function
-- =============================================================================
-- This is a migration's worth of logic living in a function on purpose. The
-- pgTAP harness applies migrations first and runs tests afterwards, so by the
-- time a test executes this migration has already run — against whatever rows
-- existed at that moment, which on a fresh database is none. Inline DML here
-- would be untestable: any test could only assert on rows the migration never
-- saw, which passes vacuously. Extracting the logic gives the migration one
-- call site and gives spec52_migration_reconciliation.sql a way to run the
-- REAL logic against fixtures it seeds itself.
--
-- p_operator scopes the sweep to a single tenant (NULL = every tenant, which
-- is what the one-shot call in PART 2 needs). It is what lets a test operate
-- on its own operator without touching anyone else's rows, and it is the right
-- shape if this ever has to be re-run for one operator by hand.
--
-- IDEMPOTENT by construction: the UPDATE moves rows OUT of the 'in_progress'
-- status it selects on, so a second call matches nothing and returns 0.
CREATE OR REPLACE FUNCTION public.reconcile_abandoned_pickup_routes(
  p_cutoff   TIMESTAMPTZ,
  p_operator UUID DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'reconcile_abandoned_pickup_routes requires a cutoff'
      USING ERRCODE = '22023';
  END IF;

  -- Mirrors cancel_pickup_route() (20260812000003 PART 7) exactly: the same
  -- three columns, and nothing else. Manifest detachment is NOT written here
  -- for the same reason it is not written there — trg_pickup_routes_status_sync
  -- (spec-47) fires AFTER UPDATE OF status and does it, setting
  -- pickup_route_id = NULL and reception_status = NULL on every linked
  -- manifest. Duplicating that here would be a second, drifting copy of the
  -- detachment rule; PART 3 asserts the trigger actually did its job instead.
  UPDATE public.pickup_routes
     SET status              = 'cancelled',
         cancelled_at        = NOW(),
         cancellation_reason = 'ruta abandonada — migración spec-52'
   WHERE status = 'in_progress'
     AND started_at < p_cutoff
     AND deleted_at IS NULL
     AND (p_operator IS NULL OR operator_id = p_operator);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

COMMENT ON FUNCTION public.reconcile_abandoned_pickup_routes(TIMESTAMPTZ, UUID)
  IS 'Cancel pickup routes left in_progress since before p_cutoff (optionally for one operator), recording the spec-52 migration reason. Manifests detach via trg_pickup_routes_status_sync. Idempotent. Called once by migration 20260812000004; retained so the sweep is testable and re-runnable per operator. EXECUTE is revoked from PUBLIC/anon/authenticated and granted to nobody: owner (postgres) or superuser only.';

-- Maintenance surface, not an API. Postgres grants EXECUTE to PUBLIC by
-- default and this function bypasses RLS — take it back.
--
-- NO GRANT FOLLOWS, AND THAT IS THE WHOLE POINT. After these revokes the only
-- principals that can execute it are the function's OWNER (postgres, which is
-- what the migration runner and the pgTAP harness connect as) and a superuser.
-- service_role is deliberately NOT granted: it is the key the application's
-- server-side code carries, and a tenant-wide route-cancellation sweep is not
-- something an application bug should be able to reach. Re-running the sweep
-- is a DBA action over psql. If you ever need it from a service-role
-- connection, add an explicit GRANT here — do not assume one exists.
REVOKE ALL ON FUNCTION public.reconcile_abandoned_pickup_routes(TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_abandoned_pickup_routes(TIMESTAMPTZ, UUID) FROM anon, authenticated;

-- =============================================================================
-- PART 2 — The one-shot sweep
-- =============================================================================
-- Cutoff '2026-08-01'. PR-2026-0001 started 2026-07-30 and falls inside it;
-- anything started in August is a route a driver may still be running today
-- and must not be touched. A fixed literal, not `NOW() - interval`, so the
-- migration cancels the same set of routes whenever it is applied — a relative
-- window would widen every day this sits unapplied in a branch.
DO $$
DECLARE v_count INT;
BEGIN
  v_count := public.reconcile_abandoned_pickup_routes('2026-08-01'::TIMESTAMPTZ, NULL);
  RAISE NOTICE 'spec-52: cancelled % abandoned pickup route(s)', v_count;
END $$;

-- =============================================================================
-- PART 3 — Post-conditions
-- =============================================================================
DO $$
DECLARE
  v_left     INT;
  v_attached INT;
BEGIN
  -- Nothing abandoned may remain.
  SELECT COUNT(*) INTO v_left FROM public.pickup_routes
   WHERE status = 'in_progress'
     AND started_at < '2026-08-01'::TIMESTAMPTZ
     AND deleted_at IS NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'reconciliation left % pre-cutoff in_progress route(s) behind', v_left;
  END IF;

  -- The status-sync trigger must have detached their manifests. If the trigger
  -- were ever dropped or disabled this migration would otherwise leave
  -- manifests pointing at cancelled routes — fail loudly instead.
  -- Narrowed to routes THIS sweep cancelled (by cancellation_reason) rather
  -- than every cancelled route: a pre-existing detachment failure is not this
  -- migration's to fail on, and would block deploy for an unrelated reason.
  SELECT COUNT(*) INTO v_attached
    FROM public.manifests m
    JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id
   WHERE pr.status = 'cancelled'
     AND pr.cancellation_reason = 'ruta abandonada — migración spec-52'
     AND m.deleted_at IS NULL;
  IF v_attached <> 0 THEN
    RAISE EXCEPTION
      '% manifest(s) still attached to a cancelled route — trg_pickup_routes_status_sync did not detach them', v_attached;
  END IF;

  RAISE NOTICE '✓ spec-52 abandoned-route reconciliation validation passed';
END $$;

COMMIT;
