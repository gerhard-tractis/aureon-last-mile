-- =============================================================================
-- spec-61 Task 2 — start_pickup_route: leader-only, crew in the same transaction
-- =============================================================================
-- Template: the LATEST definition, 20260812000003_spec52_pickup_routes_vehicle.sql:138
-- (no later migration redefines it). Everything below is that body, plus the
-- leader gate, the crew pre-flight and the crew insert.
--
-- WHY DROP AND RECREATE RATHER THAN CREATE OR REPLACE:
-- CREATE OR REPLACE cannot add a parameter, and creating (UUID, UUID[] DEFAULT)
-- alongside the existing (UUID) makes every named one-argument call ambiguous
--     ERROR: function public.start_pickup_route(p_vehicle_id => uuid) is not unique
-- which would break useStartPickupRoute.ts the moment this deploys, before the
-- frontend chunk lands. Dropping the one-argument form and giving the new
-- parameter a DEFAULT keeps every existing call site resolving unchanged --
-- including the deprecated TEXT wrapper's internal call (same file's PART 6,
-- `RETURN public.start_pickup_route(v_vehicle_id);`).
-- DROP FUNCTION also drops the GRANT; it is reissued at the bottom.
--
-- The route insert's retry loop no longer wraps the crew insert. It used to be
-- one BEGIN/EXCEPTION block; a unique_violation from the crew index inside it
-- would have been misread as a route-code collision and retried three times
-- before dying with the wrong error.
--
-- ── ROLLOUT (spec, "Rollout — read before writing the migration") ──────────
-- This repo deploys the database ahead of the frontend. Landing the gate alone
-- would refuse every existing pickup_crew account before anyone holds
-- pickup_leader (the enum value is brand new and roleOptions, the only surface
-- that grants it, does not exist until the frontend chunk deploys). So PART 1
-- below promotes every pickup_crew account to pickup_leader -- role AND
-- permission default, since a role without the permission is not bounced by
-- _client-gate (only redirects when permissions.length > 0), it renders the
-- page and hits RLS instead -- BEFORE PART 2 enforces the gate, in the same
-- migration, so no working account is ever refused.
--
-- Promoted users still need to log out and back in: the JWT role/permission
-- claims are minted at login (GlobalContext.tsx:52 reads the same claim this
-- backfill changes), so a promoted user's existing session still reads the
-- old role until they refresh it.
--
-- BACK-OUT: a follow-up migration widening the gate's role whitelist (PART 2
-- below) to include pickup_crew restores pre-spec-61 behaviour without
-- touching data or the enum -- 'pickup_leader' cannot be removed from
-- user_role once added (20260820000001's header).
--
-- QA: create-qa-users.sh gains a pickup_leader row (this commit) for a FRESH
-- QA stack. This backfill is what keeps the existing qa-pickup-crew@qa.test
-- account working through THIS deploy -- do not rely on it for a new
-- environment, which has no pickup_crew rows to promote.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — Backfill: every existing pickup_crew account becomes pickup_leader,
-- role AND permission, before the gate below can refuse anyone.
-- =============================================================================
-- WHERE is deliberately just role + deleted_at:
--   - role = 'pickup_crew' only -- every other role (operations_manager,
--     admin, super_admin, warehouse_staff, loading_crew) already passes the
--     gate or has no business with it; touching them would be an unrelated,
--     unreviewed permission change.
--   - deleted_at IS NULL -- a soft-deleted account can't log in to use the
--     promotion anyway, and promoting it would be a data change with no
--     observable effect except widening a future undelete's blast radius.
-- No operator_id filter: this is intentionally EVERY operator's pickup_crew
-- roster, matching the spec's decision that nothing breaks anywhere the
-- instant this lands. Permissions stays ARRAY['pickup'] -- identical to what
-- pickup_crew already carried (handle_new_user's CASE, 20260811000001:101,
-- and its pickup_leader twin in 20260820000002) -- so this changes WHO may
-- start a route, not what a promoted user may otherwise do.
UPDATE public.users
   SET role = 'pickup_leader',
       permissions = ARRAY['pickup']
 WHERE role = 'pickup_crew'
   AND deleted_at IS NULL;

-- =============================================================================
-- PART 2 — start_pickup_route(UUID, UUID[] DEFAULT): leader gate + crew
-- =============================================================================
DROP FUNCTION IF EXISTS public.start_pickup_route(UUID);

CREATE OR REPLACE FUNCTION public.start_pickup_route(
  p_vehicle_id    UUID,
  p_crew_user_ids UUID[] DEFAULT '{}'::UUID[]
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_driver   UUID;
  v_role     public.user_role;
  v_year     INT := EXTRACT(YEAR FROM NOW())::INT;
  v_code     TEXT;
  v_row      public.pickup_routes;
  v_vehicle  public.vehicles;
  v_uid      UUID;
  v_member   public.users;
  v_busy     TEXT;
BEGIN
  v_operator := public.get_operator_id();
  v_driver   := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'no driver (sub) in JWT' USING ERRCODE = '42501';
  END IF;

  -- ── spec-61: only a leader opens a route ────────────────────────────────
  -- Read from public.users, not from the JWT claim: the claim is minted at
  -- login and a freshly promoted leader would still be carrying the old role
  -- (GlobalContext.tsx:52 reads the same claim, which is why the UI needs a
  -- re-login too). SECURITY DEFINER, so RLS does not hide the row.
  -- operations_manager / admin / super_admin keep the capability they have
  -- today; pickup_crew is the role this spec exists to stop.
  SELECT role INTO v_role FROM public.users
   WHERE id = v_driver AND deleted_at IS NULL;

  IF v_role IS NULL
     OR v_role::text NOT IN ('pickup_leader','operations_manager','admin','super_admin') THEN
    RAISE EXCEPTION 'Solo un líder de ruta puede iniciar una ruta de retiro. Pídele a tu líder que te agregue a la suya.'
      USING ERRCODE = '42501';
  END IF;

  -- Vehicle validation. All three checks matter: the operator scope stops a
  -- cross-tenant truck, and active/deleted_at are what keep the SIN-REGISTRO
  -- backfill placeholder (and any retired truck) out of new routes.
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar un vehículo para iniciar la ruta'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles
   WHERE id = p_vehicle_id
     AND operator_id = v_operator
     AND deleted_at IS NULL;

  IF v_vehicle.id IS NULL THEN
    RAISE EXCEPTION 'El vehículo seleccionado no existe o no pertenece a este operador'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_vehicle.active THEN
    -- EXPAND-PHASE EXEMPTION (spec-52, unchanged here): the operator's
    -- SIN-REGISTRO placeholder is the one inactive vehicle a route may bind
    -- to. Every other inactive vehicle -- a retired truck -- is still refused.
    IF v_vehicle.plate <> 'SIN-REGISTRO' THEN
      RAISE EXCEPTION 'El vehículo % está inactivo y no puede iniciar una ruta', v_vehicle.plate
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── spec-61: crew pre-flight, BEFORE anything is written ────────────────
  -- Refuse, never move (spec, Open question 4). Both tables are checked: a
  -- person can be busy as a LEADER (pickup_routes.driver_id) or as CREW, and
  -- uniq_pickup_route_crew_one_active_per_user can only see the second --
  -- the leader/crew overlap has no index and is caught only here.
  FOREACH v_uid IN ARRAY COALESCE(p_crew_user_ids, '{}'::UUID[]) LOOP
    CONTINUE WHEN v_uid = v_driver;   -- the leader is not their own crew

    SELECT * INTO v_member FROM public.users
     WHERE id = v_uid AND operator_id = v_operator AND deleted_at IS NULL;
    IF v_member.id IS NULL THEN
      RAISE EXCEPTION 'Una de las personas seleccionadas no pertenece a este operador'
        USING ERRCODE = '42501';
    END IF;

    SELECT pr.code INTO v_busy FROM public.pickup_routes pr
     WHERE pr.operator_id = v_operator AND pr.driver_id = v_uid
       AND pr.status = 'in_progress' AND pr.deleted_at IS NULL
     LIMIT 1;

    IF v_busy IS NULL THEN
      SELECT pr.code INTO v_busy
        FROM public.pickup_route_crew c
        JOIN public.pickup_routes pr ON pr.id = c.pickup_route_id
       WHERE c.operator_id = v_operator AND c.user_id = v_uid
         AND c.removed_at IS NULL AND c.deleted_at IS NULL
         AND pr.status = 'in_progress' AND pr.deleted_at IS NULL
       LIMIT 1;
    END IF;

    IF v_busy IS NOT NULL THEN
      -- Names the person AND the route: "who do I go ask" is the whole
      -- point of refusing rather than moving them.
      RAISE EXCEPTION '% ya está en la ruta % y no puede estar en dos a la vez',
                      COALESCE(v_member.full_name, v_member.email), v_busy
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  -- Build code; uniqueness enforced by partial unique index per operator.
  -- Retry up to 3x on collision. The crew insert is deliberately OUTSIDE this
  -- block -- see the file header.
  FOR i IN 1..3 LOOP
    v_code := 'PR-' || v_year || '-' || lpad(nextval('pickup_routes_code_seq')::TEXT, 4, '0');
    BEGIN
      INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, vehicle_label, status)
      VALUES (v_operator, v_code, v_driver, p_vehicle_id,
              NULLIF(v_vehicle.plate, 'SIN-REGISTRO'), 'in_progress')
      RETURNING * INTO v_row;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF EXISTS (
          SELECT 1 FROM public.pickup_routes
           WHERE operator_id = v_operator
             AND driver_id = v_driver
             AND status = 'in_progress'
             AND deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'El conductor ya tiene una ruta de retiro activa'
            USING ERRCODE = '23505';
        END IF;
        v_row := NULL;   -- code collision: retry
    END;
  END LOOP;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'could not allocate pickup route code after 3 attempts';
  END IF;

  -- Same transaction as the route: a route can never exist without its crew.
  INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
  SELECT DISTINCT v_operator, v_row.id, u, v_driver
    FROM unnest(COALESCE(p_crew_user_ids, '{}'::UUID[])) AS u
   WHERE u <> v_driver;

  RETURN v_row;
END $$;

COMMENT ON FUNCTION public.start_pickup_route(UUID, UUID[])
  IS 'Open an in_progress pickup route on an active, operator-owned vehicle, with '
     'its crew, in one transaction (spec-61). Refuses a caller whose role cannot '
     'lead (pickup_leader / operations_manager / admin / super_admin may), and '
     'refuses a crew member already active on another route, naming it. Every '
     'refusal message is Spanish and shown to the driver verbatim.';

-- DROP FUNCTION took the old grant with it.
GRANT EXECUTE ON FUNCTION public.start_pickup_route(UUID, UUID[]) TO authenticated;
REVOKE ALL ON FUNCTION public.start_pickup_route(UUID, UUID[]) FROM anon;

COMMIT;
