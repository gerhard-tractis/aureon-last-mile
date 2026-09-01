-- spec-72 phase 4 — territory stability: "who ran this comuna last".
--
-- Scope, per docs/specs/spec-72-blocks-delivery-sequence.md's phase 4 bullet
-- and Decision 6: "default each andén to the driver who last ran it, and
-- warn on a break." This migration adds exactly one read-only lookup,
-- get_route_territory_history — no new table, per Decision 6's own text
-- ("this is presentation and a lookup query over existing
-- routes/dispatches/comuna data — no new table, since 'who ran this
-- territory' is fully derivable from routes.driver_name plus the comuna
-- each route's blocks covered").
--
-- Dependency check (per the phase-4 bullet: "blocked on spec-70 phase 3
-- merging, not just on spec-70's docs status"): spec-70 phase 3 (PR #552,
-- a8d2505) already merged to main and DOES persist routes.driver_name
-- locally at dispatch time --
-- apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts:304,
-- `driver_name: parsed.data.driver_identifier ?? null` -- even though
-- spec-70.md's own Status line still reads "in progress" (stale doc, not a
-- blocker; verified directly against the file and its git history before
-- writing this migration). The dependency is satisfied.
--
-- What this function does NOT attempt (deliberately, to stay inside phase
-- 4's presentation-only scope):
--   - No new "drivers" table, no driver identity normalization. A driver is
--     whatever exact string sits in routes.driver_name for a dispatched
--     route -- the same free-text field RouteBuilder already collects. Two
--     spellings of the same person are two different "drivers" to this
--     query, exactly like they already are two different values wherever
--     driver_name is read today.
--   - No time-boxed "recently" window. Decision 6's own text asks for "how
--     many times they've run it recently" but does not define a window, and
--     this repo has no existing convention for one (no "last N days" filter
--     elsewhere in the routes/dispatches schema). run_count here is an
--     unweighted count over ALL of this operator's non-cancelled routes
--     that ever covered the comuna via a live route_blocks row --
--     deliberately simple, and reconsiderable once there is a real signal
--     for what "recently" should mean operationally.
--   - Does NOT consider "orphan" orders (comuna_id set, no live block --
--     the scan-adopt gap phases 2/3 already document). This function only
--     ever looks at route_blocks membership, both for the CURRENT route's
--     comuna set (what to look up) and for HISTORICAL routes (what counts
--     as "covered this comuna"). Per spec-72's "Notes for phases 4 and 5":
--     "Phase 4's territory lookup ... derives from blocks, so it will
--     under-report until the append is run, and it will do so silently
--     [unless surfaced]." This migration cannot fix that under-reporting
--     (it is a UI-adoption-timing gap, not a query bug) -- the frontend
--     (useRouteTerritoryHistory.ts / RouteBuilder.tsx) is required to
--     surface the SAME orphan count RouteBlockList.tsx already computes
--     (useRouteBlocks' `unblocked` array, `reason === 'orphan'`) next to
--     whatever this RPC renders, so a manager sees "N stops aren't counted
--     in this check" rather than a false sense of completeness.
--
-- sequence_index is NEVER read here. Territory history only needs comuna
-- MEMBERSHIP (route_blocks.comuna_id, filtered to deleted_at IS NULL) on
-- both the current route and every historical candidate route -- it has no
-- notion of "order within a route" at all, so it is naturally immune to the
-- non-contiguous-sequence_index trap the phase-4/5 notes warn about (a
-- soft-deleted block simply has no live row to join on `deleted_at IS
-- NULL`, on either side of the query, the same way it already excludes
-- itself from every read in phases 2/3).
--
-- Route ownership + RAISE contract: same pattern as seed_default_route_blocks
-- / move_route_block (20260903000002/000003/000005) -- a foreign or
-- nonexistent p_route_id raises ROUTE_NOT_FOUND (P0002), never a silent
-- empty result, so a caller cannot mistake "wrong route id" for "no
-- territory history yet". No FOR UPDATE lock: this is a pure read with no
-- write to serialize against.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_route_territory_history(
  p_route_id    uuid,
  p_operator_id uuid
)
RETURNS TABLE (
  comuna_id       uuid,
  comuna_name     text,
  driver_name     text,
  run_count       integer,
  last_route_date date
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route RECORD;
BEGIN
  SELECT id INTO v_route
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH this_route_comunas AS (
    -- The comunas THIS route's live blocks currently cover. Orphans (see
    -- header comment) are intentionally excluded -- there is no block to
    -- read a comuna_id off of yet.
    SELECT DISTINCT rb.comuna_id
      FROM public.route_blocks rb
     WHERE rb.route_id    = p_route_id
       AND rb.operator_id = p_operator_id
       AND rb.deleted_at  IS NULL
  ),
  candidate_routes AS (
    -- Every OTHER non-cancelled route of this SAME operator that has a live
    -- block covering one of those comunas, with a non-blank driver_name.
    -- Both rb.operator_id and r.operator_id are filtered explicitly (defense
    -- in depth under SECURITY INVOKER, same double-scoping
    -- seed_default_route_blocks/move_route_block use) -- comuna ids
    -- themselves are NOT operator-scoped (chile_comunas is a shared
    -- reference table), so this is the only thing standing between two
    -- operators' history and each other for a comuna they both happen to
    -- deliver into.
    SELECT rb.comuna_id, r.driver_name, r.route_date, r.id AS route_id
      FROM public.route_blocks rb
      JOIN public.routes r
        ON r.id           = rb.route_id
       AND r.operator_id  = p_operator_id
       AND r.deleted_at   IS NULL
     WHERE rb.operator_id  = p_operator_id
       AND rb.deleted_at   IS NULL
       AND rb.route_id    <> p_route_id
       AND rb.comuna_id  IN (SELECT trc.comuna_id FROM this_route_comunas trc)
       AND r.status       <> 'cancelled'
       AND r.driver_name  IS NOT NULL
       AND btrim(r.driver_name) <> ''
  ),
  ranked AS (
    SELECT cr.*,
           ROW_NUMBER() OVER (
             PARTITION BY cr.comuna_id
             ORDER BY cr.route_date DESC, cr.route_id DESC
           ) AS rn
      FROM candidate_routes cr
  ),
  last_driver AS (
    -- One row per comuna: the most recent non-cancelled route's driver.
    -- route_id DESC as the tiebreak for same-day routes has no ordering
    -- meaning beyond "deterministic" -- there is no created_at on this CTE
    -- to break the tie by, and route_date is the only ordering fact Decision
    -- 6 actually asks for ("most recent... route").
    SELECT ranked.comuna_id, ranked.driver_name AS last_driver_name, ranked.route_date AS last_route_date
      FROM ranked
     WHERE rn = 1
  )
  SELECT
    ld.comuna_id,
    c.nombre::text,
    ld.last_driver_name::text,
    (
      SELECT COUNT(*)::integer
        FROM candidate_routes cr
       WHERE cr.comuna_id   = ld.comuna_id
         AND cr.driver_name = ld.last_driver_name
    ) AS run_count,
    ld.last_route_date
  FROM last_driver ld
  JOIN public.chile_comunas c ON c.id = ld.comuna_id;
END;
$$;

COMMENT ON FUNCTION public.get_route_territory_history(uuid, uuid) IS
  'spec-72 phase 4 (Decision 6). For each comuna covered by a LIVE route_blocks '
  'row on p_route_id, returns the driver_name of the most recent OTHER '
  'non-cancelled route of this operator that also covered that comuna via a '
  'live block, plus how many of this operator''s non-cancelled routes (all-time, '
  'no time window -- see migration header) that same driver has run there. '
  'comuna_id IS the join key -- sequence_index is never read. Orphan orders '
  '(comuna_id set, no live block yet) are NOT covered by this lookup; the '
  'frontend caller (useRouteTerritoryHistory.ts) is responsible for surfacing '
  'the same orphan count useRouteBlocks.ts already computes, so this presentation '
  'gap is visible rather than silent. Raises ROUTE_NOT_FOUND (P0002) for a route '
  'that does not exist or is not this operator''s, matching '
  'seed_default_route_blocks/move_route_block.';

GRANT EXECUTE ON FUNCTION public.get_route_territory_history(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_route_territory_history'
  ) THEN
    RAISE EXCEPTION 'get_route_territory_history function missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 4 (get_route_territory_history) migration complete';
END $$;

COMMIT;
