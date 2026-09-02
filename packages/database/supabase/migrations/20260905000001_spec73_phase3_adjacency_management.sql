-- =============================================================================
-- spec-73 phase 3 — adjacency management: add/remove dock_zone_adjacency
-- pairs, symmetric at write time.
--
-- Direction decision (spec's Data model note, and the phase 4 "Direction
-- hazard" paragraph, docs/specs/spec-73-capacity-ladder-truck-topup.md):
-- dock_zone_adjacency is directional in storage. Phase 1 deliberately left
-- open whether the write path stores one direction or both. This migration
-- resolves it: adding a pair writes BOTH (A,B) and (B,A) as live rows, and
-- removing a pair soft-deletes BOTH. Rationale — phase 4's documented read
-- is `WHERE dock_zone_id = X OR adjacent_zone_id = X` WITH DISTINCT, which
-- is correct regardless of whether one or two directions are stored; writing
-- both directions here is what makes a *single-column* read (or any future
-- reader that forgets the OR) correct too. The asymmetry the phase-4 note
-- warns about ("X offers Y but Y does not offer X") becomes structurally
-- impossible rather than something every future reader must remember to
-- avoid.
--
-- Both directions are written by ONE INSERT statement (two VALUES rows) —
-- and both are soft-deleted by ONE UPDATE statement (an OR across both
-- column orders) — inside a single SECURITY DEFINER function. A single SQL
-- statement in Postgres is atomic on its own; wrapping both operations in
-- one plpgsql function additionally means a client can never observe or
-- request a partial write (there is no second round-trip to fail after the
-- first succeeds).
--
-- Re-adding a previously soft-deleted pair: this migration chooses INSERT a
-- new row, not resurrect (UPDATE ... SET deleted_at = NULL) the old one.
-- This matches the behaviour phase 1's own test suite already asserts (TEST
-- 6 in spec73_vehicle_capacity.test.sql: a soft-deleted pair's
-- (operator_id, dock_zone_id, adjacent_zone_id) is proven reinsertable via a
-- plain INSERT, precisely because unique_dock_zone_adjacency_pair is a
-- partial index that ignores soft-deleted rows). Resurrecting would require
-- first checking for a soft-deleted row per direction and branching between
-- UPDATE/INSERT for each — two more statements, two more race windows,
-- for no behavioural gain: nothing reads dock_zone_adjacency.id or
-- .created_at across a delete/re-add cycle. ON CONFLICT ... WHERE
-- deleted_at IS NULL DO NOTHING also keeps this function idempotent against
-- an already-live pair (a caller retrying after a network blip does not
-- error).
--
-- Role gate: spec-73's Open Questions section asks to confirm against the
-- current permission set rather than assume ops_leader alone. This reuses
-- PLAN_MANAGER_ROLES verbatim (apps/frontend/src/lib/permissions.ts,
-- spec-70's canRemoveFromPlan gate: ops_leader / operations_manager / admin
-- / super_admin) — a superset of spec-68's manual-dock-assignment
-- MANAGER_ROLES (ops_leader / operations_manager / admin,
-- useManualDockAssignment.ts) that additionally covers super_admin, and
-- unlike that UI-only gate, this one is enforced here, in the database, not
-- only in a component. Pattern (SECURITY DEFINER, role read from
-- public.users rather than the JWT claim so a freshly promoted manager
-- doesn't need to re-login to pass it, NOT IN (...) refusal) copies
-- 20260824000003_spec66_start_pickup_route_ops_leader.sql's
-- start_pickup_route, the latest definition of that pattern in the repo.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- add_dock_zone_adjacency_pair — writes both directions atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_dock_zone_adjacency_pair(
  p_dock_zone_id UUID,
  p_adjacent_zone_id UUID
) RETURNS SETOF public.dock_zone_adjacency
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_uid      UUID;
  v_role     public.user_role;
BEGIN
  v_operator := public.get_operator_id();
  v_uid := NULLIF(auth.jwt() ->> 'sub', '')::UUID;

  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no user in JWT' USING ERRCODE = '42501';
  END IF;

  -- Read from public.users, not the JWT claim — same reasoning as
  -- start_pickup_route: the claim is minted at login, so a manager promoted
  -- moments ago would otherwise need to sign out/in before this passes.
  -- SECURITY DEFINER means RLS does not hide the row.
  SELECT role INTO v_role FROM public.users
   WHERE id = v_uid AND operator_id = v_operator AND deleted_at IS NULL;

  IF v_role IS NULL
     OR v_role::text NOT IN ('ops_leader', 'operations_manager', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Solo un responsable puede configurar la adyacencia de andenes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_dock_zone_id IS NULL OR p_adjacent_zone_id IS NULL THEN
    RAISE EXCEPTION 'Debe indicar ambos andenes.' USING ERRCODE = '22023';
  END IF;

  IF p_dock_zone_id = p_adjacent_zone_id THEN
    RAISE EXCEPTION 'Un andén no puede ser adyacente a sí mismo.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.dock_zones
     WHERE id = p_dock_zone_id AND operator_id = v_operator AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Andén no encontrado.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.dock_zones
     WHERE id = p_adjacent_zone_id AND operator_id = v_operator AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Andén adyacente no encontrado.' USING ERRCODE = '22023';
  END IF;

  -- Both directions, one statement — see migration header. ON CONFLICT ...
  -- DO NOTHING makes this idempotent (a retry, or a pair that was already
  -- asymmetric for some other reason, both self-heal to fully symmetric
  -- without erroring).
  -- The two VALUES rows are ordered CANONICALLY (LEAST first, GREATEST
  -- second) rather than in the caller's argument order. Both orders write
  -- exactly the same two rows, but a multi-row INSERT takes its speculative
  -- row locks in VALUES order: with the caller's order, two concurrent
  -- managers adding the SAME pair with SWAPPED arguments -- add(A,B) and
  -- add(B,A) -- each hold one direction and wait on the other, and Postgres
  -- resolves it by aborting one with a 40P01 deadlock. Sorting the pair here
  -- makes every caller of every pair acquire the two rows in the same global
  -- order, so that deadlock class cannot arise.
  RETURN QUERY
  INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  VALUES
    (v_operator, LEAST(p_dock_zone_id, p_adjacent_zone_id), GREATEST(p_dock_zone_id, p_adjacent_zone_id)),
    (v_operator, GREATEST(p_dock_zone_id, p_adjacent_zone_id), LEAST(p_dock_zone_id, p_adjacent_zone_id))
  ON CONFLICT (operator_id, dock_zone_id, adjacent_zone_id) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.add_dock_zone_adjacency_pair(UUID, UUID) IS
  'spec-73 phase 3. Adds a dock_zone_adjacency pair symmetrically: writes '
  'both (dock_zone_id, adjacent_zone_id) and its reverse as live rows in one '
  'statement. Manager-only (ops_leader/operations_manager/admin/super_admin, '
  'PLAN_MANAGER_ROLES). Re-adding a previously soft-deleted pair inserts a '
  'new row rather than resurrecting the old one — see migration header.';

GRANT EXECUTE ON FUNCTION public.add_dock_zone_adjacency_pair(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.add_dock_zone_adjacency_pair(UUID, UUID) FROM anon;

-- ---------------------------------------------------------------------------
-- remove_dock_zone_adjacency_pair — soft-deletes both directions atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_dock_zone_adjacency_pair(
  p_dock_zone_id UUID,
  p_adjacent_zone_id UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_uid      UUID;
  v_role     public.user_role;
  v_count    INT;
BEGIN
  v_operator := public.get_operator_id();
  v_uid := NULLIF(auth.jwt() ->> 'sub', '')::UUID;

  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no user in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.users
   WHERE id = v_uid AND operator_id = v_operator AND deleted_at IS NULL;

  IF v_role IS NULL
     OR v_role::text NOT IN ('ops_leader', 'operations_manager', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Solo un responsable puede configurar la adyacencia de andenes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_dock_zone_id IS NULL OR p_adjacent_zone_id IS NULL THEN
    RAISE EXCEPTION 'Debe indicar ambos andenes.' USING ERRCODE = '22023';
  END IF;

  -- Both directions, one statement — soft delete only (never a hard
  -- DELETE, per CLAUDE.md's non-negotiable rule).
  UPDATE public.dock_zone_adjacency
     SET deleted_at = NOW()
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND (
       (dock_zone_id = p_dock_zone_id AND adjacent_zone_id = p_adjacent_zone_id)
       OR (dock_zone_id = p_adjacent_zone_id AND adjacent_zone_id = p_dock_zone_id)
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.remove_dock_zone_adjacency_pair(UUID, UUID) IS
  'spec-73 phase 3. Soft-deletes a dock_zone_adjacency pair symmetrically: '
  'sets deleted_at on both the (dock_zone_id, adjacent_zone_id) row and its '
  'reverse in one statement. Manager-only, same gate as '
  'add_dock_zone_adjacency_pair. Returns the number of rows soft-deleted '
  '(0, 1, or 2) — 0 means the pair was not live in either direction.';

GRANT EXECUTE ON FUNCTION public.remove_dock_zone_adjacency_pair(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_dock_zone_adjacency_pair(UUID, UUID) FROM anon;

-- ---------------------------------------------------------------------------
-- Lock the table down to the two RPCs above (review finding, phase 3).
--
-- Phase 1 shipped `GRANT SELECT, INSERT, UPDATE ... TO authenticated` plus a
-- tenant-only RLS policy (`FOR ALL USING/WITH CHECK operator_id =
-- get_operator_id()`), and Supabase's default ACL on a new public table adds
-- DELETE/TRUNCATE on top. That combination means the role gate the two RPCs
-- enforce was bypassable by every authenticated user of the operator: a
-- warehouse_staff session could POST straight to /rest/v1/dock_zone_adjacency
-- to insert an adjacency row, and could DELETE (hard, not soft) every
-- adjacency row the operator has -- proven RED before this REVOKE landed.
-- The RLS policy stops cross-tenant writes; it says nothing about which
-- ROLE inside the tenant may write, which is precisely what this phase adds.
--
-- SELECT stays: useDockZoneAdjacencyPairs reads the table directly under RLS.
-- The two functions are SECURITY DEFINER and run as the migration owner, so
-- they are unaffected by this REVOKE -- they become the only write path, and
-- with them the only soft-delete-respecting one.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dock_zone_adjacency FROM authenticated;

-- ---------------------------------------------------------------------------
-- Soft-deleting an andén must take its adjacency rows with it (review
-- finding, phase 3).
--
-- dock_zone_adjacency's two FKs carry ON DELETE CASCADE, but dock_zones is
-- NEVER hard-deleted in this repo (useDockZones.ts soft-deletes it with an
-- UPDATE), so that cascade can never fire. Without this trigger, retiring an
-- andén leaves its adjacency rows LIVE and pointing at a dead zone: the
-- settings list renders a pair naming an andén that no longer exists, and —
-- the part that matters — phase 4's top-up candidate search
-- (`WHERE dock_zone_id = X OR adjacent_zone_id = X ... deleted_at IS NULL`)
-- would happily propose a retired andén as a place to top a truck up from.
-- Proven RED before this trigger landed: soft-deleting a zone left 2 live
-- adjacency rows behind.
--
-- SECURITY DEFINER is required, not decorative: the REVOKE above means the
-- `authenticated` role performing the dock_zones UPDATE has no UPDATE
-- privilege on dock_zone_adjacency, so a plain (INVOKER) trigger would turn
-- every andén soft-delete into a permission-denied error.
CREATE OR REPLACE FUNCTION public.cascade_dock_zone_soft_delete_to_adjacency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.dock_zone_adjacency
     SET deleted_at = NEW.deleted_at
   WHERE deleted_at IS NULL
     AND operator_id = NEW.operator_id
     AND (dock_zone_id = NEW.id OR adjacent_zone_id = NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cascade_dock_zone_soft_delete_to_adjacency() IS
  'spec-73 phase 3 (review). Soft-deletes every live dock_zone_adjacency row '
  'naming a dock_zone that has just been soft-deleted, in either direction. '
  'The FKs'' ON DELETE CASCADE never fires because dock_zones is only ever '
  'soft-deleted; this is its soft-delete equivalent.';

DROP TRIGGER IF EXISTS dock_zone_soft_delete_cascades_to_adjacency ON public.dock_zones;
CREATE TRIGGER dock_zone_soft_delete_cascades_to_adjacency
  AFTER UPDATE OF deleted_at ON public.dock_zones
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.cascade_dock_zone_soft_delete_to_adjacency();

-- Backfill: any pair already orphaned by a zone retired before this migration.
UPDATE public.dock_zone_adjacency a
   SET deleted_at = NOW()
 WHERE a.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.dock_zones z
      WHERE z.id IN (a.dock_zone_id, a.adjacent_zone_id)
        AND z.deleted_at IS NOT NULL
   );

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'add_dock_zone_adjacency_pair'
  ) THEN
    RAISE EXCEPTION 'add_dock_zone_adjacency_pair not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'remove_dock_zone_adjacency_pair'
  ) THEN
    RAISE EXCEPTION 'remove_dock_zone_adjacency_pair not created';
  END IF;
  IF has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated still has a direct write path to dock_zone_adjacency';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on dock_zone_adjacency (the list read needs it)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.dock_zones'::regclass
       AND tgname = 'dock_zone_soft_delete_cascades_to_adjacency'
  ) THEN
    RAISE EXCEPTION 'dock_zone_soft_delete_cascades_to_adjacency trigger not created';
  END IF;
  RAISE NOTICE '✓ spec-73 phase 3 (adjacency management RPCs) migration complete';
END $$;

COMMIT;
