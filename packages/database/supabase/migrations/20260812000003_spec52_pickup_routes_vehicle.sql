-- =============================================================================
-- spec-52 Task 3 — pickup_routes.vehicle_id (NOT NULL) + cancellation_reason
-- =============================================================================
-- The driver must pick a real truck from public.vehicles (spec-52 Task 1) when
-- starting a pickup route. Free-text pickup_routes.vehicle_label is left in
-- place for historical rows; nothing writes it any more.
--
-- Order matters and is not negotiable: every existing pickup_routes row has to
-- be pointed at *some* vehicle before vehicle_id can be made NOT NULL. Rather
-- than invent a plate per operator we park them all on one per-operator
-- placeholder, 'SIN-REGISTRO', created with active = false. The three vehicle
-- checks added to start_pickup_route() below (own operator, active, not
-- soft-deleted) are what make that placeholder genuinely unselectable — without
-- them `active = false` is just a comment.
--
-- Everything runs in one transaction. If any step fails the migration aborts.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — Per-operator placeholder vehicle for the backfill
-- =============================================================================
-- One row per operator that owns at least one pickup_routes row. Idempotent:
-- re-running finds the existing live SIN-REGISTRO row and inserts nothing.
--
-- Fail loudly on an ACTIVE SIN-REGISTRO row rather than adopting it as the
-- placeholder: the whole design rests on the placeholder being active = false,
-- and silently inheriting someone's hand-inserted active row would make every
-- backfilled route point at a selectable vehicle. Nothing writes this plate
-- today (public.vehicles was created empty in Task 1), so this cannot fire in
-- production — it exists to keep that true.
DO $$
DECLARE v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM public.vehicles
   WHERE plate = 'SIN-REGISTRO' AND active AND deleted_at IS NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      '% active SIN-REGISTRO vehicle row(s) exist; the backfill placeholder must be inactive. Deactivate or rename them, then re-run.', v_bad;
  END IF;
END $$;

INSERT INTO public.vehicles (operator_id, plate, vehicle_type, active)
SELECT DISTINCT pr.operator_id, 'SIN-REGISTRO', NULL, false
  FROM public.pickup_routes pr
 WHERE NOT EXISTS (
   SELECT 1 FROM public.vehicles v
    WHERE v.operator_id = pr.operator_id
      AND v.plate = 'SIN-REGISTRO'
      AND v.deleted_at IS NULL
      AND v.active = false
 );

-- =============================================================================
-- PART 2 — Columns
-- =============================================================================
ALTER TABLE public.pickup_routes
  ADD COLUMN IF NOT EXISTS vehicle_id          UUID REFERENCES public.vehicles(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN public.pickup_routes.vehicle_id IS
  'Truck this trip runs on (spec-52). NOT NULL — historical rows were backfilled to the operator''s inactive SIN-REGISTRO placeholder.';
COMMENT ON COLUMN public.pickup_routes.cancellation_reason IS
  'Free-text reason passed to cancel_pickup_route(). Before spec-52 the p_reason argument was accepted and discarded.';
COMMENT ON COLUMN public.pickup_routes.vehicle_label IS
  'DEPRECATED (spec-52): free-text truck label kept for pre-spec-52 rows. New routes carry vehicle_id instead; nothing writes this column.';

-- =============================================================================
-- PART 3 — Backfill, then constrain
-- =============================================================================
UPDATE public.pickup_routes pr
   SET vehicle_id = v.id
  FROM public.vehicles v
 WHERE v.operator_id = pr.operator_id
   AND v.plate = 'SIN-REGISTRO'
   AND v.deleted_at IS NULL
   AND pr.vehicle_id IS NULL;

DO $$
DECLARE v_orphans INT;
BEGIN
  SELECT COUNT(*) INTO v_orphans FROM public.pickup_routes WHERE vehicle_id IS NULL;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'backfill left % pickup_routes rows without a vehicle_id', v_orphans;
  END IF;
END $$;

ALTER TABLE public.pickup_routes ALTER COLUMN vehicle_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pickup_routes_vehicle
  ON public.pickup_routes(operator_id, vehicle_id);

-- =============================================================================
-- PART 4 — Active-route uniqueness: the per-DRIVER invariant only
-- =============================================================================
-- Predicate narrows from status IN ('draft','in_progress') to 'in_progress':
-- start_pickup_route() creates routes directly as in_progress and nothing in
-- the codebase ever writes 'draft'. The rebuild is safe on live data because
-- the new predicate is a strict subset of the old one — any row set that
-- satisfied the old index still satisfies this one.
--
-- The per-DRIVER index matters because
-- apps/frontend/src/hooks/useActivePickupRoute.ts orders by started_at DESC and
-- takes .limit(1) — with two active routes a driver silently gets the newest and
-- sees no error at all. Only the index turns that into a visible failure.
DROP INDEX IF EXISTS public.uniq_pickup_routes_one_active_per_driver;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_routes_one_active_per_driver
  ON public.pickup_routes(operator_id, driver_id)
  WHERE status = 'in_progress' AND deleted_at IS NULL;

-- DELIBERATELY NOT CREATED HERE: uniq_pickup_routes_one_active_per_vehicle
-- on (operator_id, vehicle_id) with the same predicate. That is a CONTRACT-phase
-- constraint and this is the expand phase. Until the VehicleSelect UI exists,
-- routes legitimately SHARE a vehicle row: every blank-label route resolves to
-- the operator's single SIN-REGISTRO placeholder, and two drivers who both type
-- "camion 1" resolve to one find-or-create'd row. Enforcing one-active-route-
-- per-vehicle now would block the second driver in both cases — a regression,
-- since today both routes start fine. spec-52 Task 8 adds the index together
-- with the UI that lets a driver pick a distinct truck. The non-unique
-- idx_pickup_routes_vehicle created in PART 3 covers lookups meanwhile.

-- =============================================================================
-- PART 5 — start_pickup_route(UUID)
-- =============================================================================
-- Template: 20260625000001_spec47_pickup_routes_consolidated_reception.sql:298
-- (the latest definition — no later migration redefines it).
--
-- The old TEXT overload is deliberately NOT dropped here. Merging this repo's
-- database chunk auto-deploys, and the frontend still calls
-- start_pickup_route(p_vehicle_label) at useStartPickupRoute.ts:18 — dropping
-- the signature now would break driver route creation in production, and
-- TypeScript would not catch it (.rpc() args are not checked against the
-- generated types). Expand/contract: PART 6 below replaces it with a thin
-- compatibility wrapper, and spec-52 Task 8 drops it once the frontend passes
-- p_vehicle_id.
CREATE OR REPLACE FUNCTION public.start_pickup_route(
  p_vehicle_id UUID
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_driver   UUID;
  v_year     INT := EXTRACT(YEAR FROM NOW())::INT;
  v_code     TEXT;
  v_row      public.pickup_routes;
  v_vehicle  public.vehicles;
BEGIN
  v_operator := public.get_operator_id();
  v_driver   := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'no driver (sub) in JWT' USING ERRCODE = '42501';
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
    -- EXPAND-PHASE EXEMPTION: the operator's SIN-REGISTRO placeholder is the
    -- one inactive vehicle a route may bind to. start_pickup_route(TEXT) sends
    -- blank labels there, and the frontend field is still optional
    -- (StartRouteButton.tsx:61 says "Vehículo (opcional)"), so refusing it
    -- would hard-error every driver who taps Iniciar without typing a plate.
    -- This grants no capability the blank-label path does not already grant.
    -- Every other inactive vehicle — a retired truck — is still refused.
    -- spec-52 Task 8 removes this exemption when the field becomes required.
    IF v_vehicle.plate <> 'SIN-REGISTRO' THEN
      RAISE EXCEPTION 'El vehículo % está inactivo y no puede iniciar una ruta', v_vehicle.plate
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Build code; uniqueness enforced by partial unique index per operator.
  -- Retry up to 3x on collision.
  FOR i IN 1..3 LOOP
    v_code := 'PR-' || v_year || '-' || lpad(nextval('pickup_routes_code_seq')::TEXT, 4, '0');
    BEGIN
      -- vehicle_label is deprecated but still READ by the warehouse UI
      -- (reception/route/[routeId]/page.tsx:124, IncomingRoutesList.tsx:40,
      -- pickup/route/active/page.tsx:85). Writing the plate keeps it truthful
      -- through the expand phase; without it those screens would show no truck
      -- identifier at all for every new route until the frontend chunk lands.
      -- The placeholder has no real plate, so it stays NULL — exactly what a
      -- blank-label route recorded before spec-52.
      INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, vehicle_label, status)
      VALUES (v_operator, v_code, v_driver, p_vehicle_id,
              NULLIF(v_vehicle.plate, 'SIN-REGISTRO'), 'in_progress')
      RETURNING * INTO v_row;
      RETURN v_row;
    EXCEPTION
      WHEN unique_violation THEN
        -- The single-active-route-per-driver partial index also lives here;
        -- surface a cleaner error by re-checking. Predicate matches the index
        -- above: 'in_progress' only. There is deliberately no per-vehicle
        -- re-check — that index is deferred to Task 8 (see PART 4), and during
        -- the expand phase routes legitimately share a vehicle row.
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
        -- otherwise it was a code collision: retry
    END;
  END LOOP;
  RAISE EXCEPTION 'could not allocate pickup route code after 3 attempts';
END $$;

COMMENT ON FUNCTION public.start_pickup_route(UUID)
  IS 'Create a new in_progress pickup_routes row for the caller (driver) on an active, operator-owned vehicle (spec-52).';

GRANT EXECUTE ON FUNCTION public.start_pickup_route(UUID) TO authenticated;

-- =============================================================================
-- PART 5b — placeholder resolver (internal)
-- =============================================================================
-- Resolves the operator's inactive SIN-REGISTRO row, creating it if this
-- operator had no pre-spec-52 routes and so got no placeholder in PART 1.
-- Internal to the expand phase; removed with the wrapper in Task 8.
CREATE OR REPLACE FUNCTION public._get_or_create_unregistered_vehicle(
  p_operator UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.vehicles
   WHERE operator_id = p_operator
     AND plate = 'SIN-REGISTRO'
     AND active = false
     AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Race-safe, same reasoning as the plate path below.
  INSERT INTO public.vehicles (operator_id, plate, active)
  VALUES (p_operator, 'SIN-REGISTRO', false)
  ON CONFLICT (operator_id, plate) WHERE deleted_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Lost the race, or an ACTIVE SIN-REGISTRO row was planted by hand. Only
    -- an inactive row is acceptable — binding routes to an active one would
    -- make the placeholder selectable through the plate path.
    SELECT id INTO v_id FROM public.vehicles
     WHERE operator_id = p_operator
       AND plate = 'SIN-REGISTRO'
       AND active = false
       AND deleted_at IS NULL
     ORDER BY created_at
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION
      'No se pudo resolver el vehículo SIN-REGISTRO del operador % (¿existe una fila activa con esa patente?)', p_operator
      USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END $$;

COMMENT ON FUNCTION public._get_or_create_unregistered_vehicle(UUID)
  IS 'INTERNAL (spec-52 expand phase). Resolves an operator''s inactive SIN-REGISTRO placeholder for blank-label routes started via the deprecated start_pickup_route(TEXT). Removed by spec-52 Task 8.';

-- Internal: reachable only from the SECURITY DEFINER wrapper, never over the
-- REST surface. Postgres grants EXECUTE to PUBLIC by default — take it back.
REVOKE ALL ON FUNCTION public._get_or_create_unregistered_vehicle(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._get_or_create_unregistered_vehicle(UUID) FROM anon, authenticated;

-- =============================================================================
-- PART 6 — start_pickup_route(TEXT): DEPRECATED compatibility wrapper
-- =============================================================================
-- Exists only so this database chunk can deploy ahead of the frontend, which
-- still calls start_pickup_route(p_vehicle_label). It resolves the label to a
-- real vehicle and delegates; it holds no route logic of its own.
--
-- The find-or-create is not throwaway scaffolding — it is exactly what the
-- frontend's inline "registrar patente" flow will do, so behaviour is
-- identical before and after the frontend chunk lands.
-- DEFAULT NULL is carried over from the spec-47 signature on purpose:
-- CREATE OR REPLACE cannot remove an existing parameter default ("cannot
-- remove parameter defaults of existing function"), and dropping the function
-- to change that is the one thing this expand phase must not do. A zero-arg
-- call therefore still resolves here and lands on the empty-plate error below.
CREATE OR REPLACE FUNCTION public.start_pickup_route(
  p_vehicle_label TEXT DEFAULT NULL
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator   UUID;
  v_plate      TEXT;
  v_vehicle_id UUID;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_plate := upper(btrim(COALESCE(p_vehicle_label, '')));

  -- BLANK LABEL IS LEGAL and must stay that way: StartRouteButton.tsx:61
  -- labels the field "Vehículo (opcional)" and :32 sends
  -- `label.trim() || null`, so useStartPickupRoute.ts passes
  -- p_vehicle_label: null on every route started without typing a plate.
  -- Raising here would hard-error those drivers the moment this deploys.
  -- Route them to the operator's inactive SIN-REGISTRO placeholder: the row
  -- is unselectable through the plate path, and the resulting route is
  -- exactly as unregistered as it was before spec-52, when it simply carried
  -- vehicle_label = NULL.
  IF v_plate = '' THEN
    RETURN public.start_pickup_route(public._get_or_create_unregistered_vehicle(v_operator));
  END IF;

  -- Reserved plate guard, and it must come FIRST. 'SIN-REGISTRO' is the
  -- backfill placeholder: for an operator that has one it is active = false, so
  -- the inactive branch below would catch it — but for an operator that has
  -- none (no pre-spec-52 routes) the find-or-create would happily create an
  -- ACTIVE row named SIN-REGISTRO and hand the placeholder name real routes.
  -- Where a placeholder does exist, the insert would instead escape as a raw
  -- 23505 from uniq_vehicles_operator_plate. Both are unacceptable.
  IF v_plate = 'SIN-REGISTRO' THEN
    RAISE EXCEPTION 'SIN-REGISTRO es un marcador interno del sistema y no puede usarse como patente'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_vehicle_id
    FROM public.vehicles
   WHERE operator_id = v_operator
     AND plate = v_plate
     AND active
     AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    -- uniq_vehicles_operator_plate covers (operator_id, plate) WHERE
    -- deleted_at IS NULL and does NOT consider `active`, so a retired truck
    -- with this plate would turn the insert into a raw unique violation.
    -- Report it as what it is instead.
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE operator_id = v_operator
         AND plate = v_plate
         AND deleted_at IS NULL
         AND NOT active
    ) THEN
      RAISE EXCEPTION 'El vehículo % está inactivo y no puede iniciar una ruta', v_plate
        USING ERRCODE = '22023';
    END IF;

    -- Race-safe: two drivers registering the same new plate at once must not
    -- leave the loser holding a raw 23505 — the very leak the guards above
    -- exist to prevent. ON CONFLICT DO NOTHING returns no row for the loser,
    -- who then re-reads the winner's row.
    INSERT INTO public.vehicles (operator_id, plate, active)
    VALUES (v_operator, v_plate, true)
    ON CONFLICT (operator_id, plate) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id INTO v_vehicle_id;

    IF v_vehicle_id IS NULL THEN
      SELECT id INTO v_vehicle_id FROM public.vehicles
       WHERE operator_id = v_operator AND plate = v_plate AND deleted_at IS NULL;
    END IF;
  END IF;

  RETURN public.start_pickup_route(v_vehicle_id);
END $$;

COMMENT ON FUNCTION public.start_pickup_route(TEXT)
  IS 'DEPRECATED (spec-52). Compatibility wrapper over start_pickup_route(UUID): normalizes the plate, finds-or-creates the vehicle, delegates. Exists only so the spec-52 database chunk can deploy ahead of the frontend, which still calls this signature at useStartPickupRoute.ts. spec-52 Task 8 drops it once the frontend passes p_vehicle_id.';

GRANT EXECUTE ON FUNCTION public.start_pickup_route(TEXT) TO authenticated;

-- =============================================================================
-- PART 7 — cancel_pickup_route persists p_reason
-- =============================================================================
-- Template: 20260625000001_spec47_pickup_routes_consolidated_reception.sql:453.
-- Only change: p_reason lands in the new cancellation_reason column instead of
-- being dropped on the floor (see the comment at :484 of that migration).
CREATE OR REPLACE FUNCTION public.cancel_pickup_route(
  p_route_id UUID,
  p_reason   TEXT
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_route    public.pickup_routes;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;
  IF v_route.status NOT IN ('draft','in_progress') THEN
    RAISE EXCEPTION 'cannot cancel route in status %', v_route.status;
  END IF;

  UPDATE public.pickup_routes
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancellation_reason = NULLIF(trim(COALESCE(p_reason, '')), '')
   WHERE id = p_route_id
  RETURNING * INTO v_route;

  RETURN v_route;
END $$;

COMMENT ON FUNCTION public.cancel_pickup_route(UUID, TEXT)
  IS 'Cancel a draft/in_progress pickup route, recording p_reason in cancellation_reason; trigger detaches its manifests (spec-47, spec-52).';

-- =============================================================================
-- PART 8 — Validation
-- =============================================================================
DO $$
BEGIN
  -- Both overloads must be present during the expand phase: UUID is the real
  -- one, TEXT is the wrapper the current frontend still calls.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
       AND p.pronargs = 1 AND p.proargtypes[0] = 'text'::regtype
  ) THEN
    RAISE EXCEPTION 'start_pickup_route(TEXT) compatibility wrapper missing — the frontend would break on deploy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
       AND p.pronargs = 1 AND p.proargtypes[0] = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION 'start_pickup_route(UUID) missing';
  END IF;
  -- uniq_pickup_routes_one_active_per_vehicle is deliberately absent — see
  -- PART 4. Assert that, so a well-meaning re-add during the expand phase
  -- fails loudly here instead of blocking a second driver in production.
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uniq_pickup_routes_one_active_per_vehicle'
  ) THEN
    RAISE EXCEPTION 'uniq_pickup_routes_one_active_per_vehicle exists, but the per-vehicle invariant belongs to spec-52 Task 8 (contract phase) — during expand, routes legitimately share a vehicle';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uniq_pickup_routes_one_active_per_driver'
  ) THEN
    RAISE EXCEPTION 'uniq_pickup_routes_one_active_per_driver missing';
  END IF;
  RAISE NOTICE '✓ spec-52 pickup_routes.vehicle_id migration validation passed';
END $$;

COMMIT;
