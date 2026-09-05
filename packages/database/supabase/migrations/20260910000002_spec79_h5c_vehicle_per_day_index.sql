-- =============================================================================
-- spec-79 H5c — a truck can be reserved twice on the same day.
--
-- `PATCH /api/dispatch/routes/[id]` (spec-76 2d) already checks this at the
-- application layer: it reads for a busy route on the same
-- (operator_id, vehicle_id, route_date, active status), then writes. That
-- read-then-write is NOT atomic — two concurrent PATCH requests assigning
-- the same vehicle to two different routes can both pass the read before
-- either write commits, and both writes then succeed. No constraint in the
-- database backs the application check; revisiting every migration in this
-- series confirmed it (spec-79's own Scope H5c).
--
-- Assessed fresh for this pass, since PATCH /routes/[id] has since grown a
-- same-route TOCTOU guard (Review I4: the UPDATE itself re-asserts
-- `status IN OPEN_ROUTE_STATUSES`) — that guard closes a DIFFERENT race (the
-- route's own status changing mid-assignment), not the cross-route one this
-- index exists for. Two concurrent PATCH calls for two DIFFERENT routes,
-- both assigning vehicle V, still both pass the SELECT-then-UPDATE above.
-- Only a database constraint, checked at commit, closes a race between two
-- independent transactions — the application-layer read cannot. The index
-- below is still the correct fix.
--
-- Cost at production scale: `routes` — not `dispatches`/`packages`, where
-- this series has twice hit statement_timeout — holds one row per route.
-- No backfill: this is a NEW constraint on future writes, not a data
-- correction. The one real risk is PRE-EXISTING rows that already violate
-- it, which would make `CREATE UNIQUE INDEX` fail outright (not time out).
-- Measured with a read-only pre-check below; the index is only created when
-- none are found, so a bad production state cannot break deployment — it
-- surfaces as a NOTICE, and someone reconciles those routes by hand before
-- re-running this migration's CREATE UNIQUE INDEX.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_conflict_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_conflict_count
  FROM (
    SELECT operator_id, vehicle_id, route_date
      FROM public.routes
     WHERE deleted_at IS NULL
       AND vehicle_id IS NOT NULL
       AND status IN ('draft','planned','loading','loaded','dispatched','in_transit','in_progress')
     GROUP BY operator_id, vehicle_id, route_date
    HAVING COUNT(*) > 1
  ) conflicts;

  IF v_conflict_count > 0 THEN
    RAISE NOTICE 'spec-79 H5c: % existing (operator_id, vehicle_id, route_date) group(s) already violate routes_one_vehicle_per_day — skipping index creation. Reconcile those routes by hand, then run this migration''s CREATE UNIQUE INDEX statement directly.', v_conflict_count;
  ELSE
    -- Both DDL statements go through EXECUTE, kept strictly inside this
    -- branch: a bare `COMMENT ON INDEX` placed unconditionally AFTER this
    -- DO block would abort the whole migration whenever the conflict
    -- branch above runs instead and the index is never created.
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS routes_one_vehicle_per_day '
      || 'ON public.routes (operator_id, vehicle_id, route_date) '
      || 'WHERE deleted_at IS NULL AND vehicle_id IS NOT NULL '
      || 'AND status IN (''draft'',''planned'',''loading'',''loaded'',''dispatched'',''in_transit'',''in_progress'')';

    EXECUTE 'COMMENT ON INDEX public.routes_one_vehicle_per_day IS '
      || quote_literal(
           'spec-79 H5c. Backs PATCH /api/dispatch/routes/[id]''s application-layer '
           'busy-route check with a real constraint -- that check reads then writes, '
           'not atomically, so two concurrent assignments of the same vehicle to two '
           'different routes could both pass it. A 23505 here is mapped to the same '
           '409 VEHICLE_ALREADY_ASSIGNED_TODAY the application check already '
           'returns. Matches ACTIVE_ROUTE_STATUSES (apps/frontend/src/lib/dispatch/'
           'types.ts) -- keep both lists in sync if that set ever changes.'
         );
  END IF;
END $$;

COMMIT;
