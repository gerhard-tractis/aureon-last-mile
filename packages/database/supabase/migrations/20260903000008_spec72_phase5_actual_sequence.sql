-- spec-72 phase 5 (FINAL) — actual-sequence capture.
--
-- Scope, per docs/specs/spec-72-blocks-delivery-sequence.md's phase 5 bullet
-- and Decision 4: "compute and write dispatches.actual_sequence from
-- arrived_at/completed_at ordering once a route reaches completed." Column
-- already exists (phase 1, 20260903000001) with no writer; this migration is
-- that writer, and only that writer -- no further write path, per the phase
-- 5 bullet's own closing sentence ("Read-only reporting ... is presentation
-- over this column; no further write path").
--
-- WHERE it is written: a trigger on routes, firing on the UPDATE that flips
-- status -> 'completed'. This is "the same webhook path that already writes
-- arrived_at/completed_at" in spirit (Decision 4) without touching the n8n
-- workflow JSON at apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json
-- -- that file is an operational artifact imported into a live n8n instance,
-- not something this repo's CI or pgTAP suite can exercise, and it already
-- writes dispatches.arrived_at/completed_at via a plain PostgREST PATCH and
-- routes.status via a plain PostgREST PATCH (the 'route' case, "if body.started
-- AND body.ended -> routeStatus = 'completed'"). A PostgREST UPDATE is a
-- normal SQL UPDATE under the hood, so a trigger on that column transition
-- fires for it exactly the same as for any other path that flips a route to
-- completed (a future in-app "mark completed" action, a test, a manual
-- correction) -- this is the "scheduled pass" alternative the phase-5 bullet
-- itself offers, collapsed into a transition trigger instead of a cron: it
-- runs exactly once, at exactly the moment the fact ("this route is done")
-- becomes true, rather than polling for it.
--
-- WHAT it computes: a per-route ROW_NUMBER over dispatches ordered by
-- COALESCE(arrived_at, completed_at) ascending (Decision 4: "ordering a
-- route's dispatches by arrived_at (or completed_at where arrived_at is
-- absent)"). A dispatch with neither timestamp has no arrival signal at all
-- and gets actual_sequence = NULL, not an arbitrary trailing rank -- an
-- unranked NULL is honest about "no data", a fabricated rank at the end
-- would claim knowledge the row doesn't have. Re-running (idempotent, same
-- shape as seed_default_route_blocks/move_route_block's re-runnability) both
-- assigns fresh ranks to newly-timestamped rows AND reverts any row that lost
-- its timestamp back to NULL, so a correction never leaves a stale rank
-- behind.
--
-- Split into a standalone, directly-callable, operator-scoped RPC
-- (compute_route_actual_sequence) plus a thin trigger function that invokes
-- it, rather than inlining the logic only in the trigger -- same reasoning
-- phase 2's header comment gives for splitting out seed_default_route_blocks:
-- idempotency and "re-run on a route already computed" are cleaner to test
-- against a named function, and it stays directly callable as this phase's
-- own "scheduled pass over completed routes" alternative (a cron/backfill
-- that re-derives for any already-completed route, without needing another
-- status flip to re-trigger it).
--
-- Route ownership + RAISE contract: same ROUTE_NOT_FOUND (P0002) pattern as
-- seed_default_route_blocks / move_route_block / get_route_territory_history
-- (20260903000002/000003/000006) -- a foreign or nonexistent p_route_id
-- raises, never a silent no-op. FOR UPDATE locks the route row, matching
-- those same functions; when called from the trigger this re-locks a row the
-- triggering UPDATE's own transaction already holds, which Postgres allows
-- (no self-deadlock -- same transaction, same row).
--
-- What this migration deliberately does NOT do: no map, pin, geocode,
-- drag-and-drop, or route optimisation (spec-72 Non-Goals, unchanged by this
-- phase); no outbound push of actual_sequence anywhere (Decision 3's outbound
-- gap stays exactly as open as phase 1-4 left it); no new UI screen -- the
-- planned-vs-actual comparison is presentation the frontend layer builds over
-- this column (RouteBlockList.tsx / useRouteBlocks.ts, this same PR), not a
-- SQL-side comparison function.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. compute_route_actual_sequence — the writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_route_actual_sequence(
  p_route_id    uuid,
  p_operator_id uuid
)
RETURNS void
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
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Rank every live dispatch on this route that has an arrival signal,
  -- earliest first. COALESCE(arrived_at, completed_at) is Decision 4's own
  -- fallback order; `d.id` is a pure deterministic tiebreak for the
  -- vanishingly-rare exact-timestamp tie, carrying no ordering meaning
  -- beyond "stable" (same non-claim spec-72's other rank tiebreaks make).
  WITH ranked AS (
    SELECT d.id,
           ROW_NUMBER() OVER (
             ORDER BY COALESCE(d.arrived_at, d.completed_at) ASC, d.id ASC
           ) AS rn
      FROM public.dispatches d
     WHERE d.route_id     = p_route_id
       AND d.operator_id  = p_operator_id
       AND d.deleted_at   IS NULL
       AND COALESCE(d.arrived_at, d.completed_at) IS NOT NULL
  )
  UPDATE public.dispatches d
     SET actual_sequence = ranked.rn
    FROM ranked
   WHERE d.id            = ranked.id
     AND d.operator_id   = p_operator_id
     AND d.actual_sequence IS DISTINCT FROM ranked.rn;

  -- Idempotent revert: a dispatch that previously had a rank but has since
  -- lost its only timestamp (a correction, a webhook replay) goes back to
  -- NULL rather than keeping a now-untrue rank. Scoped to this route/operator
  -- only -- this function never touches a dispatch outside p_route_id.
  UPDATE public.dispatches d
     SET actual_sequence = NULL
   WHERE d.route_id      = p_route_id
     AND d.operator_id   = p_operator_id
     AND d.deleted_at    IS NULL
     AND d.actual_sequence IS NOT NULL
     AND COALESCE(d.arrived_at, d.completed_at) IS NULL;
END;
$$;

COMMENT ON FUNCTION public.compute_route_actual_sequence(uuid, uuid) IS
  'spec-72 phase 5. Writes dispatches.actual_sequence for every live dispatch '
  'on this route that has arrived_at or completed_at, ROW_NUMBER-ranked '
  'earliest first (Decision 4) -- ranks are always distinct and consecutive, '
  'so an exact-timestamp tie yields N and N+1 (broken on d.id), never a '
  'shared rank or a hole. A dispatch with neither timestamp is left/reverted to '
  'NULL, never given a fabricated trailing rank. Idempotent: safe to call '
  'again for the same route (e.g. as a backfill/"scheduled pass" per the '
  'phase-5 bullet''s own alternative to the completed-transition trigger '
  'below). Raises ROUTE_NOT_FOUND (P0002) for a route that does not exist / '
  'is not this operator''s, matching seed_default_route_blocks / '
  'move_route_block / get_route_territory_history. Never touches '
  'planned_sequence or route_blocks -- this is the "what happened" half of '
  'Decision 4''s planned-vs-actual pair, not the plan.';

GRANT EXECUTE ON FUNCTION public.compute_route_actual_sequence(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trigger: fire compute_route_actual_sequence on the completed transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spec72_sync_actual_sequence_on_route_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM public.compute_route_actual_sequence(NEW.id, NEW.operator_id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.spec72_sync_actual_sequence_on_route_completed() IS
  'spec-72 phase 5. AFTER UPDATE trigger body for routes: on the transition '
  'INTO status=''completed'' (any other status change, including staying '
  'completed or leaving it, is a no-op), computes this route''s '
  'actual_sequence via compute_route_actual_sequence. This is what makes the '
  'DispatchTrack webhook''s plain PostgREST PATCH of routes.status (the '
  '''route'' case in paris-dispatchtrack-webhook.json) a writer of '
  'actual_sequence without that workflow file needing to know this column '
  'exists -- a normal UPDATE fires this trigger the same as any other path '
  'that completes a route.';

DROP TRIGGER IF EXISTS sync_actual_sequence_on_route_completed ON public.routes;

CREATE TRIGGER sync_actual_sequence_on_route_completed
  AFTER UPDATE ON public.routes
  FOR EACH ROW
  EXECUTE FUNCTION public.spec72_sync_actual_sequence_on_route_completed();

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'compute_route_actual_sequence'
  ) THEN
    RAISE EXCEPTION 'compute_route_actual_sequence function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'spec72_sync_actual_sequence_on_route_completed'
  ) THEN
    RAISE EXCEPTION 'spec72_sync_actual_sequence_on_route_completed function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.routes'::regclass
       AND tgname  = 'sync_actual_sequence_on_route_completed'
  ) THEN
    RAISE EXCEPTION 'sync_actual_sequence_on_route_completed trigger missing';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 5 (compute_route_actual_sequence, completed-transition trigger) migration complete';
END $$;

COMMIT;
