-- spec-71 phase 2 — position assignment, release, and the offset re-check.
--
-- Design: a Postgres function, matching how this repo already does this
-- class of work (create_seeded_route, transition_route_status) — an
-- operation that must (a) run under RLS as the calling user (SECURITY
-- INVOKER), (b) lock and validate a routes row before writing it, and (c)
-- guarantee a race against a concurrent caller ends in a clean domain error
-- rather than a raw constraint-violation string. The API layer's job is only
-- to call these at the right lifecycle points and write the audit_logs row
-- (audit_logs needs session.user.id / IP, which a SQL function does not
-- have — every audit_logs INSERT in this schema for a request-driven event
-- already happens at the API layer, e.g. [id]/dispatch/route.ts and
-- [id]/packages/[pkgId]/route.ts; this follows that precedent, not the
-- reverse).
--
-- Five functions:
--
--   load_position_conflicts_with_route(load_position_id, route_id, operator_id)
--     Decision 7's offset rule, as a boolean predicate. Shared by
--     assign_load_position (exclude conflicting candidates / reject an
--     explicit conflicting target) and check_load_position_conflict (the
--     re-check surfaced after a dispatch-set change).
--
--   assign_load_position(route_id, operator_id, user_id, load_position_id DEFAULT NULL)
--     Decision 8. Called with load_position_id NULL for the best-effort
--     auto-select path (route creation / reaching `planned`): picks the
--     lowest-code live, unoccupied, non-conflicting position, or returns
--     NULL if none is free — no error, no queue, per Decision 8. Called
--     with an explicit load_position_id for a specific target (manual
--     (re)assignment): raises POSITION_NOT_FOUND, POSITION_ALREADY_OCCUPIED,
--     or POSITION_OFFSET_CONFLICT rather than silently falling back.
--     Idempotent: a route already holding an active (un-released) position
--     is left untouched. Reassigning a route to a position after release
--     resets load_position_released_at/_by to NULL (the phase-1 migration's
--     documented contract for unique_route_per_active_load_position).
--
--   release_load_position(route_id, operator_id, user_id)
--     Decision 4/8. Stamps released_at/released_by; LEAVES load_position_id
--     set (routes_load_position_released_requires_id_chk rejects clearing
--     it). Idempotent: a no-op on a route with no position or an
--     already-released one.
--
--   check_load_position_conflict(route_id, operator_id)
--     The offset re-check for Decision 7's residual risk: a route's
--     dispatch set can change after assignment and introduce a new source
--     andén the assigned position fronts. Returns
--     {load_position_id, conflict} so a caller (the scan handler on an
--     adopted package, the package-removal handler) can surface the
--     conflict rather than swallow it. No automatic reassignment — that is
--     explicitly not designed here (spec-71's phase 2 bullet). Raises
--     ROUTE_NOT_FOUND (P0002) rather than returning a NULL row when the
--     route does not exist / does not belong to the operator, matching
--     assign_load_position and release_load_position's contract — a caller
--     that ignores the RPC's `error` field must not be able to mistake
--     "route missing" for "no conflict".
--
--   sweep_load_position_assignments(operator_id, user_id, limit DEFAULT 20)
--     The missing half of Decision 8's "assigned later, whenever one is
--     released" — see the phase 2 bullet in the spec. release_load_position
--     only frees a position; nothing previously re-attempted assignment for
--     routes left at load_position_id IS NULL, so with fewer positions than
--     routes in a day, once every position was taken the overflow routes
--     stayed unassigned forever, even after positions freed up. Called
--     best-effort after a successful release (currently only
--     [id]/dispatch/route.ts's POST). Scans this operator's routes with
--     load_position_id IS NULL, deleted_at IS NULL, status IN ('planned',
--     'loading', 'loaded') — the same pre-dispatch window Decision 8 assigns
--     into — oldest `created_at` first (the route that has been waiting
--     longest for a position, regardless of which of those three states it
--     is currently in, is served first; a route in `loading`/`loaded` with
--     no position only means none was ever free for it, so it is exactly as
--     overdue as an old `planned` one and there is no reason to rank one
--     state ahead of another). Bounded by `p_limit` (default 20, matching
--     the phase-2 pgTAP fixture's order of magnitude with headroom, so one
--     dispatch request's best-effort sweep can never turn into unbounded
--     work) so it attempts at most that many routes per call, in one
--     round-trip rather than N calls from the API. Returns the (route_id,
--     load_position_id) pairs it actually assigned, so the caller can write
--     one audit_logs row per assignment exactly like the existing
--     assign_load_position call sites do (audit_logs needs
--     session.user.id / IP, which stays an API-layer concern per this
--     file's header). Delegates every guard (occupancy, the offset rule,
--     idempotency, the unique-violation race) to assign_load_position
--     itself — this function is purely the missing "try everyone who's
--     waiting" loop around it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The offset rule, as a predicate
-- ---------------------------------------------------------------------------
--
-- A position conflicts with a route when it fronts a LIVE andén (dock_zones
-- row with deleted_at IS NULL) that the route currently sources a package
-- from. Per spec-71 Decision 7's consumer contract: a position whose
-- fronts_dock_zone_id points at a *retired* andén (the join below returns no
-- row) is treated as "no live conflict" — soft-deleted andenes are common in
-- this schema and a dangling FK must not permanently exclude the position it
-- was set on.
--
-- Source andenes are derived exactly as the spec states: this route's
-- dispatches -> packages (via order_id) -> packages.dock_zone_id. Mirrors
-- get_pre_route_snapshot's ready_pkgs/routed_ids join style.
CREATE OR REPLACE FUNCTION public.load_position_conflicts_with_route(
  p_load_position_id uuid,
  p_route_id          uuid,
  p_operator_id        uuid
) RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.load_positions lp
      JOIN public.dock_zones dz
        ON dz.id = lp.fronts_dock_zone_id
       AND dz.deleted_at IS NULL
     WHERE lp.id = p_load_position_id
       AND EXISTS (
         SELECT 1
           FROM public.dispatches d
           JOIN public.packages p
             ON p.order_id    = d.order_id
            AND p.operator_id = d.operator_id
            AND p.deleted_at  IS NULL
          WHERE d.route_id     = p_route_id
            AND d.operator_id  = p_operator_id
            AND d.deleted_at   IS NULL
            AND p.dock_zone_id = dz.id
       )
  );
$$;

COMMENT ON FUNCTION public.load_position_conflicts_with_route(uuid, uuid, uuid) IS
  'spec-71 Decision 7. TRUE when the given load_positions row fronts a live '
  '(non-soft-deleted) andén the given route currently sources a package '
  'from. A position fronting a retired andén never conflicts.';

GRANT EXECUTE ON FUNCTION public.load_position_conflicts_with_route(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Assignment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_load_position(
  p_route_id          uuid,
  p_operator_id       uuid,
  p_user_id           uuid,
  p_load_position_id  uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route     RECORD;
  v_candidate uuid;
BEGIN
  SELECT id, load_position_id, load_position_released_at
    INTO v_route
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: a route already holding an active (un-released) position
  -- keeps it. This function assigns/reassigns; it never swaps a live
  -- occupancy out from under a route mid-flight — release first.
  IF v_route.load_position_id IS NOT NULL AND v_route.load_position_released_at IS NULL THEN
    RETURN v_route.load_position_id;
  END IF;

  IF p_load_position_id IS NOT NULL THEN
    -- Explicit target: lock it and validate every guard, raising a domain
    -- error rather than silently falling back to "no position" — an
    -- explicit request that cannot be honoured is a caller mistake or a
    -- race, not a best-effort miss.
    SELECT id INTO v_candidate
      FROM public.load_positions
     WHERE id = p_load_position_id
       AND operator_id = p_operator_id
       AND is_active = true
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'POSITION_NOT_FOUND: load position % for operator %', p_load_position_id, p_operator_id
        USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.routes r
       WHERE r.load_position_id = v_candidate
         AND r.load_position_released_at IS NULL
         AND r.deleted_at IS NULL
         AND r.id <> p_route_id
    ) THEN
      RAISE EXCEPTION 'POSITION_ALREADY_OCCUPIED: load position % is occupied by another route', v_candidate
        USING ERRCODE = 'P0001';
    END IF;

    IF public.load_position_conflicts_with_route(v_candidate, p_route_id, p_operator_id) THEN
      RAISE EXCEPTION 'POSITION_OFFSET_CONFLICT: load position % fronts an andén route % still sources from', v_candidate, p_route_id
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Best-effort auto-selection (Decision 8): lowest-code live, unoccupied,
    -- non-conflicting position. `FOR UPDATE OF lp SKIP LOCKED` is what
    -- actually serializes concurrent auto-assignment — two routes racing for
    -- the same position never both pick it; the loser skips the locked row
    -- and either finds a different candidate or, correctly, finds none this
    -- round.
    SELECT lp.id INTO v_candidate
      FROM public.load_positions lp
     WHERE lp.operator_id = p_operator_id
       AND lp.is_active = true
       AND lp.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.routes r
          WHERE r.load_position_id = lp.id
            AND r.load_position_released_at IS NULL
            AND r.deleted_at IS NULL
            AND r.id <> p_route_id
       )
       AND NOT public.load_position_conflicts_with_route(lp.id, p_route_id, p_operator_id)
     ORDER BY lp.code
     FOR UPDATE OF lp SKIP LOCKED
     LIMIT 1;

    IF v_candidate IS NULL THEN
      -- Best-effort: no position available is not an error (Decision 8).
      RETURN NULL;
    END IF;
  END IF;

  BEGIN
    UPDATE public.routes
       SET load_position_id          = v_candidate,
           load_position_assigned_at = now(),
           load_position_assigned_by = p_user_id,
           load_position_released_at = NULL,
           load_position_released_by = NULL,
           updated_at                = now()
     WHERE id = p_route_id
       AND operator_id = p_operator_id;
  EXCEPTION WHEN unique_violation THEN
    -- unique_route_per_active_load_position lost a race the checks above
    -- could not see (belt-and-suspenders — FOR UPDATE [SKIP LOCKED] above
    -- should make this unreachable in practice). Explicit target: translate
    -- into the same clean domain error a synchronous check would have
    -- raised, never the raw constraint-violation string. Auto-select:
    -- "none available this round" is itself a valid best-effort outcome.
    IF p_load_position_id IS NOT NULL THEN
      RAISE EXCEPTION 'POSITION_ALREADY_OCCUPIED: load position % is occupied by another route', p_load_position_id
        USING ERRCODE = 'P0001';
    ELSE
      -- Belt-and-suspenders paying off would mean the FOR UPDATE [SKIP
      -- LOCKED] candidate selection above missed a real race. That is an
      -- occupancy bug, not an ordinary best-effort miss ("nothing free this
      -- round") — the two must not look identical in the logs, so this is
      -- RAISE WARNING'd (not silently swallowed) even though the return
      -- contract (NULL, no exception) is unchanged.
      RAISE WARNING 'assign_load_position: unique_violation on auto-select for route % (operator %) — the FOR UPDATE SKIP LOCKED candidate scan missed a real race; treating as best-effort "none free"', p_route_id, p_operator_id;
      RETURN NULL;
    END IF;
  END;

  RETURN v_candidate;
END;
$$;

COMMENT ON FUNCTION public.assign_load_position(uuid, uuid, uuid, uuid) IS
  'spec-71 Decision 8. Assigns a load_positions row to a route. With '
  'p_load_position_id NULL: best-effort auto-select (lowest-code live, '
  'unoccupied, offset-non-conflicting position), returns NULL and raises no '
  'error if none is free. With p_load_position_id set: assigns exactly that '
  'position or raises POSITION_NOT_FOUND / POSITION_ALREADY_OCCUPIED / '
  'POSITION_OFFSET_CONFLICT (P0001/P0002). Idempotent on a route already '
  'holding an active position. Reassigning a released route resets '
  'load_position_released_at/_by to NULL, per the occupancy index contract '
  'documented in 20260827000001.';

GRANT EXECUTE ON FUNCTION public.assign_load_position(uuid, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Release
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_load_position(
  p_route_id     uuid,
  p_operator_id  uuid,
  p_user_id      uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route RECORD;
BEGIN
  SELECT id, load_position_id, load_position_released_at
    INTO v_route
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: nothing to release (never assigned, or already released).
  IF v_route.load_position_id IS NULL OR v_route.load_position_released_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- load_position_id is LEFT SET (Decision 4) — only released_at/_by move.
  -- routes_load_position_released_requires_id_chk rejects clearing it here.
  UPDATE public.routes
     SET load_position_released_at = now(),
         load_position_released_by = p_user_id,
         updated_at                = now()
   WHERE id = p_route_id
     AND operator_id = p_operator_id;
END;
$$;

COMMENT ON FUNCTION public.release_load_position(uuid, uuid, uuid) IS
  'spec-71 Decision 4/8. Releases a route from its load position: stamps '
  'load_position_released_at/_by, leaves load_position_id set. Idempotent on '
  'a route with no position or an already-released one.';

GRANT EXECUTE ON FUNCTION public.release_load_position(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Offset re-check, for surfacing after a dispatch-set change
-- ---------------------------------------------------------------------------

-- LANGUAGE plpgsql, not sql: a bare SQL function that SELECTs against a
-- WHERE that matches no row (route missing, or belongs to another operator)
-- returns no row at all — which the PostgREST/supabase-js RPC bridge hands
-- back as `data: null`, indistinguishable from a legitimate {conflict:
-- false} once a call site does `Boolean(data?.conflict)`. plpgsql lets this
-- explicitly detect the no-row case and RAISE, giving ROUTE_NOT_FOUND (P0002)
-- the same clean-domain-error treatment assign_load_position and
-- release_load_position already use, instead of a value a careless caller
-- can misread as "clean".
CREATE OR REPLACE FUNCTION public.check_load_position_conflict(
  p_route_id     uuid,
  p_operator_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route RECORD;
BEGIN
  SELECT r.load_position_id, r.load_position_released_at
    INTO v_route
    FROM public.routes r
   WHERE r.id = p_route_id
     AND r.operator_id = p_operator_id
     AND r.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'load_position_id', v_route.load_position_id,
    'conflict', (
      v_route.load_position_id IS NOT NULL
      AND v_route.load_position_released_at IS NULL
      AND public.load_position_conflicts_with_route(v_route.load_position_id, p_route_id, p_operator_id)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.check_load_position_conflict(uuid, uuid) IS
  'spec-71 Decision 7 residual risk. Re-evaluates the offset rule for a '
  'route''s CURRENT dispatch set against its currently assigned (active) '
  'position. Returns {load_position_id, conflict}; conflict=false when the '
  'route holds no active position. Raises ROUTE_NOT_FOUND (P0002) when the '
  'route does not exist / is not this operator''s, rather than returning a '
  'NULL row a caller could misread as "no conflict". Callers (the staging '
  'scan''s adopt path, package removal) surface conflict=true for '
  'reassignment — this function does not reassign anything itself.';

GRANT EXECUTE ON FUNCTION public.check_load_position_conflict(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The re-attempt sweep — the missing half of Decision 8
-- ---------------------------------------------------------------------------
--
-- spec-71 phase 2's own bullet: a route left with load_position_id NULL is
-- "assigned a position later, whenever one is released." Nothing before this
-- called assign_load_position again for such a route once a position freed
-- up — release_load_position only frees the position; it never re-attempts
-- assignment for whoever is waiting. With fewer positions than routes in a
-- day (the spec's own example: 6 positions, 8 routes) routes 7-8 stayed
-- load_position_id NULL forever, even once all 6 freed up.
CREATE OR REPLACE FUNCTION public.sweep_load_position_assignments(
  p_operator_id  uuid,
  p_user_id      uuid,
  p_limit        integer DEFAULT 20
) RETURNS TABLE (route_id uuid, load_position_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route     RECORD;
  v_assigned  uuid;
BEGIN
  FOR v_route IN
    SELECT r.id
      FROM public.routes r
     WHERE r.operator_id = p_operator_id
       AND r.deleted_at IS NULL
       AND r.load_position_id IS NULL
       -- Same pre-dispatch window Decision 8 assigns into (planned/loading/
       -- loaded — `draft` is not yet a real plan and `dispatched`+ has
       -- already moved past needing a position).
       AND r.status IN ('planned', 'loading', 'loaded')
     -- Oldest-created first: whichever of the three states it's currently
     -- in, a route that has been waiting longest for a position is served
     -- first. Deterministic, and it does not need a priority ranking
     -- between the three statuses.
     ORDER BY r.created_at ASC
     LIMIT p_limit
  LOOP
    -- assign_load_position owns every guard (occupancy, the offset rule,
    -- idempotency, the unique-violation race) and is itself best-effort on
    -- the auto-select path (NULL load_position_id) — it returns NULL rather
    -- than raising when nothing is free, which is exactly this sweep's
    -- "no-op for this route this round" case.
    v_assigned := public.assign_load_position(v_route.id, p_operator_id, p_user_id);
    IF v_assigned IS NOT NULL THEN
      route_id := v_route.id;
      load_position_id := v_assigned;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.sweep_load_position_assignments(uuid, uuid, integer) IS
  'spec-71 phase 2 bullet: re-attempts assign_load_position for this '
  'operator''s routes left at load_position_id NULL (status planned/loading/'
  'loaded, oldest created_at first), up to p_limit (default 20) per call. '
  'Best-effort throughout — never raises for "nothing free"; delegates every '
  'guard to assign_load_position. Returns the (route_id, load_position_id) '
  'pairs actually assigned so the caller can write one audit_logs row per '
  'assignment, matching the existing assign_load_position call sites.';

GRANT EXECUTE ON FUNCTION public.sweep_load_position_assignments(uuid, uuid, integer) TO authenticated;

COMMIT;
