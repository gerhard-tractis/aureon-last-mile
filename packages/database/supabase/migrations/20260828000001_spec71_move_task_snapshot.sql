-- spec-71 phase 5 — the move-task snapshot.
--
-- "Faltan por mover a posición": a mobile, andén-grouped picker of what
-- still has to physically move from an andén into a route's assigned
-- position. Pure presentation over the state phases 1-4 already built — no
-- new write path, no new tables.
--
-- Unit of count is PACKAGES, not dispatches. The phase-5 bullet under
-- Implementation phases literally says so: "packages whose dispatch is
-- `planned` or already `staged` on the andén, not yet staged onto their
-- route's position". `route_stop_counts` (20260825000002) is precedent for
-- the METHODOLOGY only (derive live from the rows, never trust a drifting
-- cached column like routes.planned_stops) — not for reusing its
-- dispatch-per-row unit here, since dispatches are per ORDER and this
-- screen's job is to tell an operator which physical parcels still have to
-- move.
--
-- Review fix (code review, phase-5 item 1) — "is this package moved" must
-- not be read off `dispatches.stage`. That column lives on the ORDER's
-- dispatch row, and phase 3's `stageDispatch` (lib/dispatch/stage-dispatch.ts)
-- flips it to 'staged' the moment the FIRST package of that order is scanned
-- to a position. A multi-bulto order (spec-55 carton expansion — every
-- package here can belong to a multi-package order, and `PendingMobileList`
-- already treats `o.packages` as the normal case, not an edge case) then
-- reads as fully staged while its other packages are still sitting on the
-- andén, and the whole route silently drops off this list with real work
-- still outstanding. The fix uses the fact phase 1 already writes per
-- PACKAGE: `dock_scans.load_position_id` (20260827000001), set on every
-- accepted position scan by `app/api/dispatch/load-positions/scan/route.ts`
-- (`moved_packages` below). `dispatches.stage` is kept only to establish
-- which packages belong to this route's plan at all (`planned`/`staged` —
-- see Decision 9's note on this bullet's own wording for why `adopted` is
-- left out), never as the per-package "moved" fact itself.
--
-- Style/precedent: get_pre_route_snapshot (20260423000002, latest def
-- 20260825000004) — a single SQL function returning one jsonb payload built
-- from CTEs, SECURITY INVOKER so the caller's own RLS scopes every table
-- touched (routes, dispatches, packages, dock_zones, load_positions,
-- dock_scans all carry operator_id RLS; this function trusts that, exactly
-- like get_pre_route_snapshot does, rather than re-filtering by
-- p_operator_id alone).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_move_task_snapshot(
  p_operator_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
-- Routes currently holding an active (assigned, un-released) position.
--
-- Review fix (item 3) — `r.status` is now filtered to the same active
-- window `unassigned_routes` below and `sweep_load_position_assignments`
-- (20260827000003) already use, matching `get_pre_route_snapshot`'s own
-- precedent (20260825000004) of naming every status a row must still be
-- "live" under rather than filtering only deleted_at. Without it, a
-- `cancelled`/`completed`/`dispatched` route that still holds
-- `load_position_id` (its release is best-effort, inside a try/catch —
-- routes/[id]/dispatch/route.ts:217-294 — and can fail) would stay on this
-- work list forever with a phantom conflict nobody can act on from here.
positioned_routes AS (
  SELECT r.id AS route_id,
         r.external_route_id,
         r.driver_name,
         r.load_position_id,
         lp.code  AS load_position_code,
         lp.label AS load_position_label
    FROM public.routes r
    JOIN public.load_positions lp
      ON lp.id = r.load_position_id
     AND lp.deleted_at IS NULL
   WHERE r.operator_id = p_operator_id
     AND r.deleted_at IS NULL
     AND r.load_position_id IS NOT NULL
     AND r.load_position_released_at IS NULL
     AND r.status IN ('planned', 'loading', 'loaded')
),

-- The other half of "routes this snapshot can ever show": Decision 8's
-- best-effort miss, no position assigned yet. Same active-status window
-- sweep_load_position_assignments sweeps into. Split out from the old
-- inline `unassigned_routes` query so it can also bound the dispatch/package
-- scan below (review item 6).
unassigned_candidate_routes AS (
  SELECT r.id AS route_id,
         r.external_route_id,
         r.driver_name
    FROM public.routes r
   WHERE r.operator_id = p_operator_id
     AND r.deleted_at IS NULL
     AND r.load_position_id IS NULL
     AND r.status IN ('planned', 'loading', 'loaded')
),

-- Review fix (item 6) — every route this snapshot could ever render, and
-- nothing else. `route_packages` below used to scan every non-deleted
-- dispatch the operator has, across all history; this bounds it to routes
-- that are actually still in play, which item 3's status filter now makes
-- a real (small) set instead of "everything, forever".
route_ids_in_scope AS (
  SELECT route_id FROM positioned_routes
  UNION
  SELECT route_id FROM unassigned_candidate_routes
),

-- Review fix (item 9) — `dispatches` has no unique constraint on
-- (route_id, order_id) among live rows, and no current writer creates a
-- duplicate, but nothing enforces that either. A duplicate live dispatch
-- for the same order would otherwise join to the same packages twice below
-- and double-count them. DISTINCT ON makes that a deliberate, cheap no-op
-- instead of a latent bug — picks the most recently created live row per
-- (route_id, order_id) if one ever exists.
route_dispatches AS (
  SELECT DISTINCT ON (d.route_id, d.order_id)
         d.route_id,
         d.order_id,
         d.operator_id,
         d.stage
    FROM public.dispatches d
   WHERE d.operator_id = p_operator_id
     AND d.deleted_at   IS NULL
     AND d.route_id     IN (SELECT route_id FROM route_ids_in_scope)
   ORDER BY d.route_id, d.order_id, d.created_at DESC, d.id
),

-- The per-PACKAGE "did it physically reach a position" fact (review item
-- 1) — see the header comment. Scoped to this operator and live rows only,
-- matching every other soft-delete-respecting read in this function.
moved_packages AS (
  SELECT DISTINCT package_id
    FROM public.dock_scans
   WHERE operator_id      = p_operator_id
     AND deleted_at       IS NULL
     AND load_position_id IS NOT NULL
     AND package_id       IS NOT NULL
),

-- Every live package on a route's dispatches, whichever route that is —
-- reused below both for positioned routes (grouped by andén) and
-- unassigned routes (a flat total).
route_packages AS (
  SELECT rd.route_id,
         rd.stage,
         p.dock_zone_id,
         dz.code AS dock_zone_code,
         dz.name AS dock_zone_name,
         -- A package sectorized onto a since-soft-deleted andén: the FK is
         -- non-NULL but the deleted_at-filtered join above returns no row.
         -- Per Decision 7's consumer contract this must not vanish the
         -- group (it still blocks a real package) or crash on a NULL code.
         (p.dock_zone_id IS NOT NULL AND dz.id IS NULL) AS zone_retired,
         -- Review item 1: the per-package "still has to move" fact, NOT
         -- rd.stage. A dispatch already 'staged' can still have packages
         -- with no moved_packages row (a multi-bulto order, one package
         -- scanned) — this must independently gate remaining, per package.
         (mp.package_id IS NULL) AS pending_move
    FROM route_dispatches rd
    JOIN public.packages p
      ON p.order_id    = rd.order_id
     AND p.operator_id = rd.operator_id
     AND p.deleted_at  IS NULL
    LEFT JOIN public.dock_zones dz
      ON dz.id = p.dock_zone_id
     AND dz.deleted_at IS NULL
    LEFT JOIN moved_packages mp
      ON mp.package_id = p.id
),

route_totals AS (
  SELECT route_id,
         COUNT(*) AS total_packages,
         -- rd.stage still decides plan MEMBERSHIP (Decision 9: 'planned' or
         -- 'staged' — 'adopted' packages were confirmed physically present
         -- by a route-level scan and are out of this screen's scope, same
         -- as the phase-5 bullet's own wording never mentions them), but
         -- pending_move (per package, via dock_scans) decides whether a
         -- member package still counts as remaining.
         COUNT(*) FILTER (WHERE stage IN ('planned', 'staged') AND pending_move) AS remaining_packages
    FROM route_packages
   GROUP BY route_id
),

-- Remaining (not-yet-moved) packages for positioned routes only, grouped
-- by the andén they currently sit in (Decision 7 — the point of the
-- grouping: each andén->position hop is a real distance apart).
remaining_by_zone AS (
  SELECT route_id,
         dock_zone_id,
         dock_zone_code,
         dock_zone_name,
         zone_retired,
         COUNT(*) AS remaining_count
    FROM route_packages
   WHERE stage IN ('planned', 'staged')
     AND pending_move
     AND route_id IN (SELECT route_id FROM positioned_routes)
   GROUP BY route_id, dock_zone_id, dock_zone_code, dock_zone_name, zone_retired
),

route_groups AS (
  SELECT route_id,
         jsonb_agg(
           jsonb_build_object(
             'dock_zone_id',    dock_zone_id,
             'dock_zone_code',  dock_zone_code,
             'dock_zone_name',  dock_zone_name,
             'is_retired',      zone_retired,
             'remaining_count', remaining_count
           )
           ORDER BY remaining_count DESC, dock_zone_code NULLS LAST
         ) AS groups
    FROM remaining_by_zone
   GROUP BY route_id
),

-- Decision 7's offset re-check, evaluated per positioned route against its
-- CURRENT dispatch set — load_position_conflicts_with_route already
-- implements the exact predicate (fronts a LIVE andén the route still
-- sources a package from); this snapshot just surfaces it per-route
-- instead of leaving it to be queried one route at a time.
route_conflicts AS (
  SELECT pr.route_id,
         public.load_position_conflicts_with_route(pr.load_position_id, pr.route_id, p_operator_id) AS offset_conflict
    FROM positioned_routes pr
),

route_rows AS (
  SELECT
    pr.route_id,
    COALESCE(rt.remaining_packages, 0) AS remaining_packages,
    COALESCE(rc.offset_conflict, false) AS offset_conflict,
    jsonb_build_object(
      'route_id',            pr.route_id,
      'external_route_id',   pr.external_route_id,
      'driver_name',         pr.driver_name,
      'load_position_id',    pr.load_position_id,
      'load_position_code',  pr.load_position_code,
      'load_position_label', pr.load_position_label,
      'total_packages',      COALESCE(rt.total_packages, 0),
      'remaining_packages',  COALESCE(rt.remaining_packages, 0),
      'offset_conflict',     COALESCE(rc.offset_conflict, false),
      'groups',              COALESCE(rg.groups, '[]'::jsonb)
    ) AS json
  FROM positioned_routes pr
  LEFT JOIN route_totals    rt ON rt.route_id = pr.route_id
  LEFT JOIN route_groups    rg ON rg.route_id = pr.route_id
  LEFT JOIN route_conflicts rc ON rc.route_id = pr.route_id
),

-- Decision 8's residual: a route that reached `planned` with no position
-- free (best-effort, no queue, no error) cannot be staged at all until one
-- frees up. It must appear here as blocked, not silently vanish from the
-- move-task list. Only routes that actually have packages waiting.
unassigned_routes AS (
  SELECT ucr.route_id,
         ucr.external_route_id,
         ucr.driver_name,
         COALESCE(rt.total_packages, 0)     AS total_packages,
         COALESCE(rt.remaining_packages, 0) AS remaining_packages
    FROM unassigned_candidate_routes ucr
    LEFT JOIN route_totals rt ON rt.route_id = ucr.route_id
   WHERE COALESCE(rt.total_packages, 0) > 0
)

SELECT jsonb_build_object(
  'generated_at', now(),

  -- A route is worth showing while it still has packages to move, OR its
  -- position now conflicts (Decision 7) even if staging is otherwise done —
  -- that route still needs a human to reassign it, per the spec's
  -- "must be visible" requirement.
  'routes', COALESCE((
    SELECT jsonb_agg(json ORDER BY (json->>'external_route_id'))
      FROM route_rows
     WHERE remaining_packages > 0 OR offset_conflict
  ), '[]'::jsonb),

  'unassigned_routes', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'route_id',           route_id,
        'external_route_id',  external_route_id,
        'driver_name',        driver_name,
        'total_packages',     total_packages,
        'remaining_packages', remaining_packages
      )
      ORDER BY external_route_id
    )
    FROM unassigned_routes
  ), '[]'::jsonb)
)
$$;

COMMENT ON FUNCTION public.get_move_task_snapshot(uuid) IS
  'spec-71 phase 5. Mobile move-task picker snapshot: for each route '
  'holding an active load position, remaining packages (dispatch stage '
  'planned/staged AND no dock_scans row carrying load_position_id yet — '
  'never dispatches.stage alone, which is per ORDER and hides partial '
  'multi-bulto progress) grouped by their current andén '
  '(packages.dock_zone_id), plus the Decision 7 offset-conflict flag and '
  'Decision 8''s unassigned (blocked, no position) routes. Counts are '
  'derived live from dispatches/packages/dock_scans, never '
  'routes.planned_stops. SECURITY INVOKER — relies on the caller''s own '
  'RLS on routes/dispatches/packages/dock_zones/load_positions/dock_scans.';

GRANT EXECUTE ON FUNCTION public.get_move_task_snapshot(uuid) TO authenticated;

COMMIT;
