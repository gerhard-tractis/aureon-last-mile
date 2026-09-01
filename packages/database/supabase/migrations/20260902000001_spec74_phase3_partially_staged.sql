-- =============================================================================
-- spec-74 phase 3 — every reader that ignored `partially_staged` learns it.
--
-- Phase 1 (20260901000001) added `partially_staged` to `dispatches.stage`'s
-- CHECK but nothing wrote it. Phase 3 (app layer, this repo's TS) is the
-- writer: each package scan recomputes the dispatch, `partially_staged`
-- while any live package of the order is still unloaded, `staged` once none
-- are. This migration is the DATABASE half of phase 3's blocker checklist
-- (docs/specs/spec-74-per-bulto-staging.md) — the two SQL readers that would
-- otherwise silently mishandle a dispatch now sitting at `partially_staged`:
--
--   1. route_stop_counts (20260825000002) — a `partially_staged` row already
--      counted in total_stops, but in none of pending_stops/staged_stops/
--      adopted_stops, so it vanished from every bucket a caller could act on.
--      `lib/dispatch/seal-route.ts` (the shared guard behind BOTH spec-70's
--      route-level /seal and spec-71's position seal) reads pending_stops to
--      decide whether to refuse — with the row counted nowhere, the seal
--      opened on a partially-loaded route, which is the exact production
--      failure spec-74 exists to fix. Given its own bucket here so the app
--      layer can fold it into the refusal without losing the ability to
--      report planned vs. partially_staged separately later.
--
--   2. get_move_task_snapshot (20260828000001) — `stage IN ('planned',
--      'staged')` decided plan MEMBERSHIP (which packages belong to a
--      route's plan at all, before checking dock_scans for whether they
--      physically reached the position). A `partially_staged` order fell out
--      of membership entirely, so its still-outstanding packages dropped off
--      the move-task list with real work left to do. Widened to `('planned',
--      'partially_staged', 'staged')`. NOT a change to what counts as
--      "moved" — that stays `dock_scans.load_position_id` (this function's
--      own review-item-1 fix, still correct, untouched here) — only to which
--      packages are considered part of the plan being moved.
--
-- `adopted` is deliberately NOT added to either `stage IN (...)` list here:
-- neither get_move_task_snapshot (Decision 9, this function's own header)
-- nor route_stop_counts' pending/staged split ever included it, and phase 3
-- does not touch that scoping. Whether an ADOPTED order is complete is a
-- different question, answered at the app layer in seal-route.ts by reading
-- packages.loaded_at directly for adopted dispatches (dispatches.stage stays
-- 'adopted' forever per spec-74 phase 2 review item 3 — it is never rewritten
-- to partially_staged/staged, so no view bucket keyed on `stage` alone can
-- ever tell an incomplete adopted order from a complete one).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. route_stop_counts: partially_staged gets its own bucket
-- ---------------------------------------------------------------------------
-- security_invoker preserved verbatim from 20260825000002 — same cross-tenant
-- rationale, unchanged.
CREATE OR REPLACE VIEW public.route_stop_counts
WITH (security_invoker = true) AS
-- Column order matters here: `CREATE OR REPLACE VIEW` refuses to reorder or
-- rename existing output columns (Postgres error "cannot change name of view
-- column"), so partially_staged_stops is APPENDED after adopted_stops rather
-- than inserted next to pending_stops/staged_stops where it reads most
-- naturally — probe-verified (a mid-list insert fails apply outright).
SELECT route_id,
       operator_id,
       COUNT(*)                                  AS total_stops,
       COUNT(*) FILTER (WHERE stage = 'planned') AS pending_stops,
       COUNT(*) FILTER (WHERE stage = 'staged')  AS staged_stops,
       COUNT(*) FILTER (WHERE stage = 'adopted') AS adopted_stops,
       COUNT(*) FILTER (WHERE stage = 'partially_staged') AS partially_staged_stops
  FROM public.dispatches
 WHERE deleted_at IS NULL
   AND route_id IS NOT NULL
 GROUP BY route_id, operator_id;

COMMENT ON VIEW public.route_stop_counts IS
  'spec-70/74. The authoritative local stop counts, derived from dispatches. '
  'routes.planned_stops stays on the table because the DispatchTrack webhooks '
  'write it from the provider''s own figure, which is a different number — '
  'nothing local should read it. partially_staged_stops (spec-74 phase 3) is '
  'its own bucket, not folded into pending_stops or staged_stops: a dispatch '
  'in that state is neither "nothing scanned" nor "fully loaded", and '
  'seal-route.ts''s completeness gate needs to tell all three apart.';

GRANT SELECT ON public.route_stop_counts TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_move_task_snapshot: partially_staged counts as plan membership too
-- ---------------------------------------------------------------------------
-- Body otherwise IDENTICAL to 20260828000001 — the latest (only) definition,
-- per the project rule of templating a CREATE OR REPLACE on the latest
-- migration. Only the two `stage IN (...)` filters (route_totals,
-- remaining_by_zone) are widened; nothing else changes.
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
         --
         -- spec-74 phase 3: widened from ('planned', 'staged'). A
         -- `partially_staged` order is still plan-membership exactly like
         -- `planned`/`staged` — it dropped out here entirely before this
         -- widening, taking its still-outstanding packages off the move
         -- list with real work left. `adopted` stays excluded — unchanged
         -- from 20260828000001, see this migration's header.
         COUNT(*) FILTER (WHERE stage IN ('planned', 'partially_staged', 'staged') AND pending_move) AS remaining_packages
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
   -- spec-74 phase 3: same widening as route_totals above, same reason.
   WHERE stage IN ('planned', 'partially_staged', 'staged')
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
  'spec-71 phase 5 / spec-74 phase 3. Mobile move-task picker snapshot: for '
  'each route holding an active load position, remaining packages (dispatch '
  'stage planned/partially_staged/staged AND no dock_scans row carrying '
  'load_position_id yet — never dispatches.stage alone, which is per ORDER '
  'and hides partial multi-bulto progress) grouped by their current andén '
  '(packages.dock_zone_id), plus the Decision 7 offset-conflict flag and '
  'Decision 8''s unassigned (blocked, no position) routes. `adopted` stays '
  'out of scope, unchanged from 20260828000001. Counts are derived live from '
  'dispatches/packages/dock_scans, never routes.planned_stops. SECURITY '
  'INVOKER — relies on the caller''s own RLS on routes/dispatches/packages/'
  'dock_zones/load_positions/dock_scans.';

GRANT EXECUTE ON FUNCTION public.get_move_task_snapshot(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. recompute_dispatch_stage — atomic recompute-and-write (review Fix 3)
-- ---------------------------------------------------------------------------
-- Blocker checklist fix. `stage-dispatch.ts`'s `stageDispatch` used to read
-- "any other live scannable package of this order still unloaded?" from the
-- app layer, then write `dispatches.stage` in a SEPARATE statement — two
-- round trips with no lock between them. Two bultos of one order scanned
-- concurrently (two devices at a dock, which is the normal case, not an
-- edge case) each read the OTHER box as still outstanding before either
-- write lands, so both compute `partially_staged` and both write it — even
-- though both packages end up loaded. The dispatch is then stuck at
-- `partially_staged` forever with nothing left to scan: the exact
-- permanent-refusal failure Fix 1 exists to prevent, reached a different
-- way. Folding the read, the row lock, and the write into one statement
-- inside the database is the only way to close that window; two app-layer
-- round trips can never be made atomic against each other.
--
-- Call contract: the caller (`stageDispatch`) MUST write the scanned
-- package's own `loaded_at` BEFORE calling this function (Fix 2 — see
-- `advancePackagesToEnCarga`'s new call order in stage-dispatch.ts). This
-- function does not take a package id and does not exclude the
-- just-scanned package by id; it relies entirely on that package's
-- `loaded_at` already being non-NULL by the time it queries `packages`, so
-- the plain `loaded_at IS NULL` filter below excludes it correctly. Called
-- the other way around (dispatch recomputed before the package write lands)
-- reintroduces exactly the fail-open bug Fix 2 removes: a `staged` dispatch
-- whose scanned box was never actually written.
--
-- The dispatch row is locked FOR UPDATE before anything is read, so a
-- second concurrent call for the same dispatch blocks until the first
-- commits — its own recompute then sees the first call's fully-committed
-- package state, not a stale snapshot. This is what makes the concurrent-
-- scan scenario above resolve correctly instead of racing.
--
-- Status list: `('en_bodega', 'sectorizado', 'asignado', 'listo_para_despacho')`
-- below MUST stay identical to `DISPATCHABLE_STATUSES`
-- (apps/frontend/src/lib/dispatch/scan-validator.ts:28-33) — the only
-- statuses the scanner will ever accept a scan against, and per Fix 1 the
-- only statuses that can make a sibling package "outstanding". SQL cannot
-- import a TypeScript constant, so nothing enforces this beyond this
-- comment and the two suites that would go red if it drifted: this
-- migration's own pgTAP tests (spec74_phase3_partially_staged.test.sql —
-- "a `sectorizado` sibling blocks the seal", "a `dañado` sibling does not")
-- and stage-dispatch.test.ts's equivalent TS-side cases. A future author
-- changing DISPATCHABLE_STATUSES without updating this list will see one of
-- those suites fail, not a silent divergence.
CREATE OR REPLACE FUNCTION public.recompute_dispatch_stage(
  p_dispatch_id uuid,
  p_operator_id uuid,
  p_order_id    uuid,
  p_user_id     uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_stage      text;
  v_next_stage         text;
  v_outstanding_count  integer;
BEGIN
  -- Lock first, read second: nothing about this dispatch is trusted until
  -- the row is ours. `operator_id` is filtered here too (not just relied on
  -- via RLS) so a wrong-tenant id fails the row match outright rather than
  -- depending solely on the policy.
  SELECT stage INTO v_current_stage
    FROM public.dispatches
   WHERE id = p_dispatch_id
     AND operator_id = p_operator_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recompute_dispatch_stage: no dispatch row matched (dispatch %, operator %)',
      p_dispatch_id, p_operator_id;
  END IF;

  -- spec-74 phase 2 review item 3, preserved here exactly as
  -- stage-dispatch.ts preserved it: `adopted` is never rewritten. Read from
  -- the just-locked row rather than trusting a caller-supplied value, which
  -- is strictly fresher than anything the TS layer could have cached from
  -- validation time.
  IF v_current_stage = 'adopted' THEN
    v_next_stage := 'adopted';
  ELSE
    -- Fix 1's intersection, done here instead of in the caller now that the
    -- caller no longer performs this read at all.
    SELECT COUNT(*) INTO v_outstanding_count
      FROM public.packages
     WHERE operator_id = p_operator_id
       AND order_id    = p_order_id
       AND deleted_at IS NULL
       AND loaded_at  IS NULL
       AND status IN ('en_bodega', 'sectorizado', 'asignado', 'listo_para_despacho');

    v_next_stage := CASE WHEN v_outstanding_count > 0 THEN 'partially_staged' ELSE 'staged' END;
  END IF;

  UPDATE public.dispatches
     SET stage     = v_next_stage,
         staged_at = now(),
         staged_by = p_user_id
   WHERE id = p_dispatch_id
     AND operator_id = p_operator_id;

  RETURN v_next_stage;
END;
$$;

COMMENT ON FUNCTION public.recompute_dispatch_stage(uuid, uuid, uuid, uuid) IS
  'spec-74 phase 3 review Fix 3. Atomically locks a dispatch row, recomputes '
  'its stage from packages (planned/partially_staged <-> staged, adopted '
  'preserved), and writes stage/staged_at/staged_by in one statement — '
  'closing the read-then-write race two concurrent scans of one order could '
  'hit. Caller MUST write the scanned package''s loaded_at before calling '
  '(see this function''s own header comment). SECURITY INVOKER — relies on '
  'the caller''s own RLS on dispatches/packages, exactly like every other '
  'function in this file.';

GRANT EXECUTE ON FUNCTION public.recompute_dispatch_stage(uuid, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. expand_carton: refuse a late carton once the order has real progress
--    (review Fix 4)
-- ---------------------------------------------------------------------------
-- Blocker checklist finding: `expand_carton` (20260814000002) mints new
-- sibling packages at `status = 'ingresado'`, `loaded_at NULL`, with no
-- guard against the order already being on a route. Per Fix 1,
-- `'ingresado'` sits outside `DISPATCHABLE_STATUSES` on purpose (it cannot
-- be scanned — it has not even been received yet), so a plain recompute
-- triggered on INSERT would NOT close this gap: the newly minted package
-- would still be excluded from "outstanding" by the very same status
-- filter Fix 1 just added, and `recompute_dispatch_stage` would still
-- return `staged`. An AFTER INSERT trigger that recomputes with Fix 1's own
-- predicate is therefore neutralised by Fix 1 — it would fire, find
-- nothing changed, and give a false sense of having handled this. That is
-- why this is a REFUSAL at the mint site, not a recompute trigger.
--
-- The guard: `expand_carton` already only accepts a root at
-- `'ingresado'`/`'verificado'` (its own Rule 3) — but that constrains the
-- CARTON being expanded, not the ORDER's dispatch progress. A different
-- bulto of the same order can already be scanned while its sibling carton
-- is still sitting unreceived. Refuse the mint outright once the order has
-- any live dispatch whose `stage <> 'planned'` — i.e. any real scan has
-- already happened for this order, on any route. This is deliberately
-- broader than just `'staged'`: a `'partially_staged'` order minting a new,
-- permanently-invisible-to-completeness box has the same silent-omission
-- problem, just with different timing (the box goes uncounted the moment
-- the LAST scannable sibling is later scanned, not immediately) — and an
-- `'adopted'` order was already scanned once for real, physically, on a
-- specific route. In every one of those states, more boxes need a human to
-- decide where they go, not a silent new packages row.
--
-- Residual, stated honestly rather than overclaimed: this closes the
-- literal "order already staged" case in this migration's blocker text.
-- It does NOT retroactively protect an order that reaches `'planned'`
-- (still refuses nothing there — nothing has moved yet), and it does not
-- change what happens if a box is minted while `'planned'` and THEN the
-- order's other bultos get scanned to completion — that remaining gap is
-- Fix 1's ingresado/verificado exclusion working exactly as designed
-- (see this migration's Fix 1 discussion in the phase-3 PR description),
-- and closing it fully would mean deciding that an unreceived carton
-- SHOULD gate a seal, which is the deadlock Fix 1 exists to prevent.
CREATE OR REPLACE FUNCTION public.expand_carton(
  p_package_id       UUID,
  p_additional_boxes INT,
  p_reason           TEXT
) RETURNS TABLE (
  out_id                 UUID,
  out_label              TEXT,
  out_package_number     TEXT,
  out_declared_box_count INT,
  out_parent_label       TEXT,
  out_is_generated_label BOOLEAN,
  out_order_id           UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator        UUID;
  v_actor           UUID;
  v_target          public.packages%ROWTYPE;
  v_root            public.packages%ROWTYPE;
  v_base_label      TEXT;
  v_existing_count  INT;
  v_new_total       INT;
  v_next_suffix     INT;
  v_candidate_label TEXT;
  v_new_ids         UUID[] := ARRAY[]::UUID[];
  v_new_id          UUID;
  v_external_load   VARCHAR(100);
  i                 INT;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'no actor in JWT';
  END IF;

  -- Rule 1: ownership + soft-delete. Locked here so two concurrent expansions
  -- of the same carton cannot race the suffix search below.
  SELECT * INTO v_target
    FROM public.packages
   WHERE id = p_package_id
     AND operator_id = v_operator
     AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package not found' USING ERRCODE = '42501';
  END IF;

  -- Rule 2: 1..20. A fat-fingered 300 fails loudly rather than minting 300
  -- cartons. The ceiling is arbitrary and documented as such (spec-55).
  IF p_additional_boxes IS NULL OR p_additional_boxes < 1 OR p_additional_boxes > 20 THEN
    RAISE EXCEPTION 'p_additional_boxes must be between 1 and 20, got %', p_additional_boxes;
  END IF;

  -- Rule 4: mandatory reason — mirrors enable_module_for_operator.
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  -- CTN001 always stays box 1. If the crew tapped a minted sibling instead of
  -- the parent row, walk back to the root so every expansion of a family
  -- shares one label sequence.
  IF v_target.is_generated_label THEN
    SELECT * INTO v_root
      FROM public.packages
     WHERE operator_id = v_operator
       AND label = v_target.parent_label
       AND deleted_at IS NULL
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent carton not found for %', v_target.parent_label;
    END IF;
  ELSE
    v_root := v_target;
  END IF;

  -- Rule 3: once a package is in the warehouse, expanding it silently changes
  -- counts under flows already in motion. Only ingresado/verificado allowed.
  IF v_root.status::TEXT NOT IN ('ingresado', 'verificado') THEN
    RAISE EXCEPTION 'cannot expand a carton once it has moved past verificado (current status: %)', v_root.status;
  END IF;

  -- spec-74 phase 3 review Fix 4. See this migration's header comment above
  -- CREATE FUNCTION for the full reasoning. `stage <> 'planned'` catches
  -- partially_staged/staged/adopted alike — any dispatch state that means a
  -- real scan already happened for this order, on some route.
  IF EXISTS (
    SELECT 1
      FROM public.dispatches d
     WHERE d.operator_id = v_operator
       AND d.order_id    = v_root.order_id
       AND d.deleted_at  IS NULL
       AND d.stage <> 'planned'
  ) THEN
    RAISE EXCEPTION
      'cannot expand carton %: order % already has dispatch progress (a bulto has been scanned) — add boxes through a supervised exception process instead',
      v_root.label, v_root.order_id
      USING ERRCODE = '42501';
  END IF;

  v_base_label := v_root.label;

  -- Rule 5/6: next free suffix + new family total. Never assume
  -- declared_box_count is the high-water mark — a carton may be expanded
  -- twice, or a previous sibling may have been soft-deleted (its label stays
  -- reserved by unique_label_per_operator, which is not partial).
  SELECT COUNT(*) INTO v_existing_count
    FROM public.packages
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND (id = v_root.id OR parent_label = v_base_label);

  v_new_total := v_existing_count + p_additional_boxes;

  -- Denominator refresh on the parent and every live sibling. The numerator
  -- is derived from each row's own label suffix (never touched once minted),
  -- not parsed back out of the old package_number text.
  UPDATE public.packages
     SET declared_box_count = v_new_total,
         package_number     = '1 de ' || v_new_total
   WHERE id = v_root.id;

  UPDATE public.packages
     SET declared_box_count = v_new_total,
         package_number     = (substring(label FROM length(v_base_label) + 2)) || ' de ' || v_new_total
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND parent_label = v_base_label
     AND id <> v_root.id;

  v_next_suffix := 2;
  FOR i IN 1..p_additional_boxes LOOP
    LOOP
      v_candidate_label := v_base_label || '-' || v_next_suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.packages
         WHERE operator_id = v_operator AND label = v_candidate_label
      );
      v_next_suffix := v_next_suffix + 1;
    END LOOP;

    INSERT INTO public.packages (
      operator_id, order_id, label, package_number, declared_box_count,
      is_generated_label, parent_label, sku_items, status, raw_data,
      created_by_user_id
    ) VALUES (
      v_operator, v_root.order_id, v_candidate_label,
      v_next_suffix || ' de ' || v_new_total, v_new_total,
      TRUE, v_base_label, '[]'::jsonb, 'ingresado', '{}'::jsonb,
      v_actor
    )
    RETURNING packages.id INTO v_new_id;

    v_new_ids := array_append(v_new_ids, v_new_id);
    v_next_suffix := v_next_suffix + 1;
  END LOOP;

  -- Rule 7: manifests.total_packages is denormalised and read by the scan
  -- screen's progress denominator; a stale value shows 3/1.
  SELECT o.external_load_id INTO v_external_load
    FROM public.orders o
   WHERE o.id = v_root.order_id;

  IF v_external_load IS NOT NULL THEN
    UPDATE public.manifests m
       SET total_packages = (
         SELECT COUNT(*)
           FROM public.packages p
           JOIN public.orders o2 ON o2.id = p.order_id
          WHERE o2.operator_id = v_operator
            AND o2.external_load_id = m.external_load_id
            AND o2.deleted_at IS NULL
            AND p.deleted_at IS NULL
       )
     WHERE m.operator_id = v_operator
       AND m.external_load_id = v_external_load
       AND m.deleted_at IS NULL;
  END IF;

  INSERT INTO public.carton_expansion_audit
    (operator_id, package_id, parent_label, boxes_added, actor_user_id, reason)
  VALUES (v_operator, v_root.id, v_base_label, p_additional_boxes, v_actor, p_reason);

  RETURN QUERY
  SELECT p.id, p.label::TEXT, p.package_number::TEXT, p.declared_box_count,
         p.parent_label::TEXT, p.is_generated_label, p.order_id
    FROM public.packages p
   WHERE p.id = ANY(v_new_ids)
   ORDER BY p.label;
END $$;

COMMENT ON FUNCTION public.expand_carton(UUID, INT, TEXT) IS
'spec-55, widened spec-74 phase 3 review Fix 4. Mints p_additional_boxes new
packages rows as siblings of the parent carton (CTN001 stays box 1), on
observed reality at the retailer rather than the retailer''s
declared_box_count. Operator-scoped via get_operator_id() — p_package_id is
never trusted as a tenant boundary on its own. Rejects a parent past
verificado, an empty reason, a box count outside 1..20, or an order whose
dispatch already shows real scan progress (stage <> planned) on some route —
see this migration''s Fix 4 header comment for why a recompute trigger alone
would not have closed that gap.';

GRANT EXECUTE ON FUNCTION public.expand_carton(UUID, INT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'route_stop_counts'
      AND column_name = 'partially_staged_stops'
  ) THEN
    RAISE EXCEPTION 'route_stop_counts.partially_staged_stops not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'recompute_dispatch_stage'
  ) THEN
    RAISE EXCEPTION 'recompute_dispatch_stage not created';
  END IF;

  RAISE NOTICE '✓ spec-74 phase 3 (partially_staged readers) migration complete';
END $$;

COMMIT;
