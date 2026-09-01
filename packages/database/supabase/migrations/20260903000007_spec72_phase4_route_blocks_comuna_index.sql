-- spec-72 phase 4 review item 7 — index route_blocks for the territory
-- lookup's own access pattern.
--
-- get_route_territory_history's `this_route_comunas` CTE
-- (20260903000006_spec72_phase4_territory_history.sql) filters
-- `rb.route_id = p_route_id AND rb.operator_id = p_operator_id AND
-- rb.deleted_at IS NULL` — already covered by the existing
-- idx_route_blocks_operator_id / the table's own route_id index from
-- 20260903000001. The `candidate_routes` CTE is the uncovered one:
-- `rb.operator_id = p_operator_id AND rb.deleted_at IS NULL AND
-- rb.comuna_id IN (...)`, with nothing on `comuna_id` at all — an operator
-- with thousands of historical route_blocks rows scans every block they
-- have ever had, on every RouteBuilder mount (useRouteTerritoryHistory.ts,
-- staleTime: 10_000, so effectively every navigation back to a route).
--
-- Partial (`WHERE deleted_at IS NULL`), matching this repo's own convention
-- for every other route_blocks/dispatches partial index (e.g.
-- idx_dispatches_route_stage in 20260825000002) — a soft-deleted block is
-- never a candidate, in this query or any other, so indexing it is pure
-- waste.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_route_blocks_operator_comuna
  ON public.route_blocks (operator_id, comuna_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.idx_route_blocks_operator_comuna IS
  'spec-72 phase 4 review item 7. Serves get_route_territory_history''s '
  '`candidate_routes` CTE (rb.operator_id = ... AND rb.comuna_id IN (...) '
  'AND rb.deleted_at IS NULL) — without it, an operator with a long route '
  'history table-scans every route_blocks row they have ever had on every '
  'RouteBuilder mount.';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'idx_route_blocks_operator_comuna'
  ) THEN
    RAISE EXCEPTION 'idx_route_blocks_operator_comuna index missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 4 review item 7 (route_blocks operator/comuna index) migration complete';
END $$;

COMMIT;
