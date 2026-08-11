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
INSERT INTO public.vehicles (operator_id, plate, vehicle_type, active)
SELECT DISTINCT pr.operator_id, 'SIN-REGISTRO', NULL, false
  FROM public.pickup_routes pr
 WHERE NOT EXISTS (
   SELECT 1 FROM public.vehicles v
    WHERE v.operator_id = pr.operator_id
      AND v.plate = 'SIN-REGISTRO'
      AND v.deleted_at IS NULL
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
-- PART 4 — Active-route uniqueness: BOTH invariants
-- =============================================================================
-- Predicate narrows from status IN ('draft','in_progress') to 'in_progress':
-- start_pickup_route() creates routes directly as in_progress and nothing in
-- the codebase ever writes 'draft'.
--
-- Keeping the per-DRIVER index alongside the new per-VEHICLE one is deliberate.
-- apps/frontend/src/hooks/useActivePickupRoute.ts orders by started_at DESC and
-- takes .limit(1) — with two active routes a driver silently gets the newest and
-- sees no error at all. Only the index turns that into a visible failure.
DROP INDEX IF EXISTS public.uniq_pickup_routes_one_active_per_driver;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_routes_one_active_per_driver
  ON public.pickup_routes(operator_id, driver_id)
  WHERE status = 'in_progress' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_routes_one_active_per_vehicle
  ON public.pickup_routes(operator_id, vehicle_id)
  WHERE status = 'in_progress' AND deleted_at IS NULL;

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
    RAISE EXCEPTION 'El vehículo % está inactivo y no puede iniciar una ruta', v_vehicle.plate
      USING ERRCODE = '22023';
  END IF;

  -- Build code; uniqueness enforced by partial unique index per operator.
  -- Retry up to 3x on collision.
  FOR i IN 1..3 LOOP
    v_code := 'PR-' || v_year || '-' || lpad(nextval('pickup_routes_code_seq')::TEXT, 4, '0');
    BEGIN
      INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, status)
      VALUES (v_operator, v_code, v_driver, p_vehicle_id, 'in_progress')
      RETURNING * INTO v_row;
      RETURN v_row;
    EXCEPTION
      WHEN unique_violation THEN
        -- Both single-active-route partial indexes also live here; surface a
        -- cleaner error in those cases by re-checking. Predicates match the
        -- indexes above: 'in_progress' only.
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
        IF EXISTS (
          SELECT 1 FROM public.pickup_routes
           WHERE operator_id = v_operator
             AND vehicle_id = p_vehicle_id
             AND status = 'in_progress'
             AND deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'El vehículo % ya está en una ruta de retiro activa', v_vehicle.plate
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
  IF v_plate = '' THEN
    RAISE EXCEPTION 'Debe indicar la patente del vehículo para iniciar la ruta'
      USING ERRCODE = '22023';
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

    INSERT INTO public.vehicles (operator_id, plate, active)
    VALUES (v_operator, v_plate, true)
    RETURNING id INTO v_vehicle_id;
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uniq_pickup_routes_one_active_per_vehicle'
  ) THEN
    RAISE EXCEPTION 'uniq_pickup_routes_one_active_per_vehicle missing';
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
