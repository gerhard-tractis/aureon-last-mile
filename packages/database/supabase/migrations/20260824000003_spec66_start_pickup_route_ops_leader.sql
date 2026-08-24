-- =============================================================================
-- spec-66: ops_leader joins the roles that may open a pickup route
-- =============================================================================
-- Template is 20260820000003 (spec-61), the LATEST definition of
-- start_pickup_route, per CLAUDE.md. EXACTLY ONE LINE CHANGES: the role list
-- in the refusal below gains 'ops_leader'. The operator-scoped role lookup,
-- the vehicle validation, the crew seeding and the Spanish refusal message are
-- carried across byte-for-byte.
--
-- COPYING HAZARD, learned the hard way on 2026-08-24. This function ends with
-- `END $$;`, NOT `$function$;` like handle_new_user. A sed range terminated on
-- `^\$function\$;` never matches, silently runs to end of file, and drags in
-- everything after the function -- in spec-61's case its COMMENT, its GRANT,
-- its PART 3 validation block and a bare COMMIT. The validation block asserts
-- that spec-61's ONE-TIME pickup_crew -> pickup_leader backfill left no
-- pickup_crew rows, which is false in any environment that has since created
-- one (QA has qa-pickup-crew@qa.test), so the migration failed on QA and left
-- it drifted. Terminate on `^END \$\$;` and diff the extraction against the
-- template's own extraction -- diffing a bad extraction against itself proves
-- nothing.
--
-- Why the gate is on ROLE and not on a permission: spec-61 chose that
-- deliberately. Restricting who may OPEN a route is what makes a forgotten
-- crew member fail loudly (blocked, says so immediately) instead of silently
-- (opens a second route for the same van, discovered at reception). Reading
-- permissions here would let any admin hand out route creation by ticking a
-- box, which is the failure mode spec-61 exists to prevent.
--
-- This widens that set from one floor role to two. Accepted deliberately: the
-- set stays small and explicit, and the loud-failure property is unchanged.
--
-- NOT CHANGED, DELIBERATELY: cancel_pickup_route (20260821000001). It
-- authorises the route's own driver_id regardless of role, so an ops_leader
-- cancelling their own route already passes. ops_leader must NOT be added to
-- its manager override list, for the same reason that migration's header gives
-- for pickup_leader — leading routes is not authority over someone else's
-- route. tests/spec66_ops_leader_route_authz.sql asserts it stays out.
-- =============================================================================

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
  -- operator_id IS scoped here (not just id): without it a JWT whose `sub`
  -- belongs to operator X but whose operator_id claim says Y would pass the
  -- gate on X's role and then write a route under Y. The mismatch now falls
  -- into the refusal below for free, same as any other non-leader.
  SELECT role INTO v_role FROM public.users
   WHERE id = v_driver AND operator_id = v_operator AND deleted_at IS NULL;

  IF v_role IS NULL
     OR v_role::text NOT IN ('ops_leader','pickup_leader','operations_manager','admin','super_admin') THEN
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
  -- Wrapped: the pre-flight above is a READ: two leaders naming the same
  -- picker at once both pass it, and the loser would otherwise hit
  -- uniq_pickup_route_crew_one_active_per_user with no handler here --
  -- useStartPickupRoute.ts:26 does `throw new Error(error.message)`
  -- verbatim, so a raw Postgres unique-violation string would reach the
  -- driver in English, naming an internal index. Re-run the same busy
  -- lookup the pre-flight used to name the person and the route the same
  -- way; if the competing transaction hasn't committed yet, that lookup
  -- finds nothing, so a generic Spanish fallback covers the window instead
  -- of a raw string. ERRCODE stays '23505' on both this path and the
  -- pre-flight's above: both represent the same Postgres error class (a
  -- unique-violation on this exact index) and the precedent five lines
  -- above ("ruta de retiro activa") already uses '23505' for the same kind
  -- of business refusal -- a caller keying on SQLSTATE alone cannot tell
  -- "friendly" from "raw" apart, but after this fix there IS no raw path
  -- left to distinguish from; the message text is what carries the
  -- difference now.
  BEGIN
    INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
    SELECT DISTINCT v_operator, v_row.id, u, v_driver
      FROM unnest(COALESCE(p_crew_user_ids, '{}'::UUID[])) AS u
     WHERE u <> v_driver;
  EXCEPTION WHEN unique_violation THEN
    v_busy := NULL;
    FOREACH v_uid IN ARRAY COALESCE(p_crew_user_ids, '{}'::UUID[]) LOOP
      CONTINUE WHEN v_uid = v_driver;

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
        SELECT * INTO v_member FROM public.users WHERE id = v_uid;
        RAISE EXCEPTION '% ya está en la ruta % y no puede estar en dos a la vez',
                        COALESCE(v_member.full_name, v_member.email), v_busy
          USING ERRCODE = '23505';
      END IF;
    END LOOP;

    -- The competing transaction hasn't committed yet, so the lookup above
    -- found nobody to name. This IS the race window, not a bug in the loop.
    RAISE EXCEPTION 'Otro líder acaba de agregar a esa persona a su ruta. Intenta de nuevo.'
      USING ERRCODE = '23505';
  END;

  RETURN v_row;
END $$;

-- Refreshed because spec-61's version still says only pickup_leader /
-- operations_manager / admin / super_admin may lead.
COMMENT ON FUNCTION public.start_pickup_route(UUID, UUID[])
  IS 'Open an in_progress pickup route on an active, operator-owned vehicle, with '
     'its crew, in one transaction (spec-61). Refuses a caller whose role cannot '
     'lead (ops_leader / pickup_leader / operations_manager / admin / super_admin '
     'may -- spec-66 added the first), and refuses a crew member already active on '
     'another route, naming it. Every BUSINESS refusal message is Spanish and shown '
     'to the driver verbatim -- a handful of internal/should-never-happen errors '
     '(malformed JWT, exhausted code-allocation retries) stay in English.';

-- No GRANT here on purpose. spec-61 re-granted because it did DROP + CREATE,
-- which takes the old grant with it; CREATE OR REPLACE keeps the existing
-- grants, so re-issuing them would be noise.
