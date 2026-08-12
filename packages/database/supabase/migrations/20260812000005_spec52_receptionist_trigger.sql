-- =============================================================================
-- spec-52 Task 5 — receptionist opens the reception; route lock; reopen
-- =============================================================================
-- From spec-52 onwards the hub, not the driver, opens a reception batch: the
-- receptionist scans the route QR and open_route_reception() does everything
-- close_pickup_route() used to do, plus stamping who received it.
--
-- THIS IS THE **EXPAND** HALF OF AN EXPAND/CONTRACT PAIR. It ADDS paths and
-- removes none: it does NOT drop close_pickup_route(), does NOT remove the
-- '-> in_transit' branch of trg_pickup_routes_status_sync, does NOT add
-- uniq_pickup_routes_one_active_per_vehicle — all three belong to Task 8. The
-- database ships ahead of the frontend: drivers still see the "close route"
-- button and the reception UI still gates on status = 'in_transit', reached
-- today ONLY through close. Removing either side now deadlocks production.
-- PART 5 fails the deploy if any of those old paths has gone missing.
--
-- HOW THE TWO PATHS COEXIST WITHOUT DOUBLE-INSERTING
-- uniq_route_receptions_pickup_route (20260625000001) is UNIQUE on
-- pickup_route_id WHERE deleted_at IS NULL: one live batch per route, a second
-- insert raises 23505. Both writers respect it.
--   * driver closes first -> the trigger's in_transit branch inserts the batch
--     (ON CONFLICT DO NOTHING) and sets manifests to awaiting_reception; a
--     later receptionist scan finds it at STEP 2 and returns it untouched.
--   * receptionist scans first -> open_route_reception inserts the batch
--     BEFORE flipping the route status, so the trigger's ON CONFLICT DO
--     NOTHING has nothing to do. Statement order is load-bearing; do not move
--     STEP 4 after STEP 6.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — Route lock on pickup_scans
-- =============================================================================
-- A route out of the driver's hands has a FROZEN expected_count; a late pickup
-- scan would add a package the hub can never reconcile. Refuse at the source.
--
-- READ THIS BEFORE "SIMPLIFYING" THE PREDICATE: most manifests are scanned
-- BEFORE being attached to a route, so pickup_route_id is NULL then. `IF
-- v_status IS DISTINCT FROM 'in_progress'` looks equivalent and is not: NULL
-- IS DISTINCT FROM 'in_progress' is TRUE, rejecting the ordinary pickup flow.
-- NO ROUTE -> ALLOW. spec52_route_lock.sql asserts exactly that.
CREATE OR REPLACE FUNCTION public.trg_pickup_scans_enforce_route_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status public.pickup_route_status_enum; v_code TEXT;
BEGIN
  -- The INNER JOIN is what implements "no route -> allow": a NULL
  -- pickup_route_id produces no row, NOT FOUND is true, we fall through.
  --
  -- The operator predicates are NOT redundant: SECURITY DEFINER reads past
  -- RLS, and pickup_scans RLS never validates manifest_id against the row's
  -- own operator_id. Without them a caller points NEW.manifest_id at another
  -- tenant's manifest and reads that tenant's route code back out of the error
  -- message below. Scoped, a foreign manifest falls through NOT FOUND.
  SELECT pr.status, pr.code
    INTO v_status, v_code
    FROM public.manifests m
    JOIN public.pickup_routes pr
      ON pr.id = m.pickup_route_id AND pr.operator_id = m.operator_id
   WHERE m.id = NEW.manifest_id
     AND m.operator_id = NEW.operator_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_status = 'in_progress' THEN RETURN NEW; END IF;

  RAISE EXCEPTION
    'La ruta % ya fue cerrada (estado %) y no admite nuevos escaneos de retiro', v_code, v_status
    USING ERRCODE = '55000';
END $$;

COMMENT ON FUNCTION public.trg_pickup_scans_enforce_route_lock
  IS 'Reject a pickup_scans insert whose manifest belongs to a route that is no longer in_progress (spec-52). A manifest with no route is always allowed — that is the common pre-attachment path.';

DROP TRIGGER IF EXISTS trg_pickup_scans_route_lock ON public.pickup_scans;
CREATE TRIGGER trg_pickup_scans_route_lock
  BEFORE INSERT ON public.pickup_scans
  FOR EACH ROW EXECUTE FUNCTION public.trg_pickup_scans_enforce_route_lock();

-- =============================================================================
-- PART 2 — open_route_reception()
-- =============================================================================
CREATE OR REPLACE FUNCTION public.open_route_reception(
  p_route_id UUID
) RETURNS public.route_receptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID; v_actor UUID; v_perms TEXT[];
  v_route public.pickup_routes; v_rr public.route_receptions; v_expected INT;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  v_actor := auth.uid();

  -- SEPARATION OF DUTIES. This migration's header says the HUB, not the
  -- driver, opens a batch — and "authenticated inside the tenant" is not that
  -- rule, it is the absence of one. received_by is stamped from auth.uid() at
  -- STEP 4 and feeds the custody audit trail, so a driver who can call this
  -- signs for his own delivery. Same gate/roles/error shape as
  -- reopen_pickup_route below: open and undo of one hub action, no drift.
  SELECT permissions INTO v_perms FROM public.users
   WHERE id = v_actor AND deleted_at IS NULL;
  IF NOT (COALESCE(v_perms, '{}') && ARRAY['reception','operations','admin']) THEN
    RAISE EXCEPTION 'Solo recepción u operaciones pueden abrir la recepción de una ruta'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE, not a bare SELECT: two receptionists can scan the same QR at
  -- once. The row lock makes STEP 2's "does a batch exist?" and STEP 4's
  -- insert one atomic decision; without it the loser gets a raw 23505.
  SELECT * INTO v_route
    FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL
     FOR UPDATE;

  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'La ruta de retiro % no existe', p_route_id USING ERRCODE = 'P0002';
  END IF;

  -- STEP 1 — terminal states
  IF v_route.status = 'received' THEN
    RAISE EXCEPTION 'La ruta % ya fue recibida en el hub', v_route.code USING ERRCODE = '55000';
  END IF;
  IF v_route.status = 'cancelled' THEN
    RAISE EXCEPTION 'La ruta % fue anulada y no puede recibirse', v_route.code USING ERRCODE = '55000';
  END IF;

  -- STEP 2 — idempotency. A second QR scan, or a scan of a route the driver
  -- already closed the legacy way, returns the EXISTING batch untouched:
  -- re-stamping in_transit_at rewrites history and recomputing expected_count
  -- moves the number the hub counts against. `deleted_at IS NULL` is mandatory
  -- — reopen_pickup_route soft-deletes the batch, and without the filter a
  -- reopen-then-rescan hands back the dead one (spec52_reopen_route CASE 2).
  SELECT * INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_rr.id IS NOT NULL THEN RETURN v_rr; END IF;

  -- STEP 3 — freeze the expected count. DISTINCT package_id: the same package
  -- can be scanned twice and must be expected once.
  SELECT COUNT(DISTINCT ps.package_id) INTO v_expected
    FROM public.pickup_scans ps JOIN public.manifests m ON m.id = ps.manifest_id
   WHERE m.pickup_route_id = p_route_id AND m.operator_id = v_operator
     AND ps.operator_id = v_operator AND ps.scan_result = 'verified'
     AND ps.package_id IS NOT NULL;

  -- STEP 4 — create the batch. delivered_by is NOT NULL (20260625000001) and
  -- is the DRIVER, not the caller; received_by is the receptionist scanning.
  INSERT INTO public.route_receptions
    (pickup_route_id, operator_id, received_by, delivered_by, status, started_at, expected_count)
  VALUES
    (p_route_id, v_operator, v_actor, v_route.driver_id, 'pending', NOW(), COALESCE(v_expected, 0))
  RETURNING * INTO v_rr;

  -- STEP 5 — the manifests. Explicit, not left to the trigger: Task 8 deletes
  -- that branch, and a missing awaiting_reception only surfaces at reception.
  UPDATE public.manifests SET reception_status = 'awaiting_reception'
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator;

  -- STEP 6 — the route. Guarded on status so an already-in_transit route (the
  -- legacy close path, its batch since soft-deleted) neither refires the
  -- status trigger nor overwrites the original in_transit_at.
  UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
   WHERE id = p_route_id AND operator_id = v_operator AND status <> 'in_transit';

  RETURN v_rr;
END $$;

COMMENT ON FUNCTION public.open_route_reception(UUID)
  IS 'Receptionist QR scan: open (or return) the consolidated reception batch for a pickup route, flip it to in_transit and set its manifests to awaiting_reception (spec-52). Idempotent, and a no-op on a route the driver already closed via close_pickup_route. Reception/operations/admin only — received_by is an audit-trail signature, so the driver must not be able to sign for his own delivery.';

-- =============================================================================
-- PART 3 — reopen_pickup_route()
-- =============================================================================
-- The undo for a QR scanned in error: rewinds the route to in_progress and
-- SOFT-deletes the batch (soft-deletes-only per CLAUDE.md; the partial unique
-- index filters deleted_at IS NULL, so a later rescan inserts cleanly).
CREATE OR REPLACE FUNCTION public.reopen_pickup_route(
  p_route_id UUID
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID; v_perms TEXT[]; v_route public.pickup_routes;
  v_rr public.route_receptions; v_scans INT; v_blocker TEXT;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- Hub-side correction, not a driver action: a driver must not be able to
  -- pull his own route back out of the hub's queue.
  SELECT permissions INTO v_perms FROM public.users
   WHERE id = auth.uid() AND deleted_at IS NULL;
  IF NOT (COALESCE(v_perms, '{}') && ARRAY['reception','operations','admin']) THEN
    RAISE EXCEPTION 'Solo recepción u operaciones pueden reabrir una ruta'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL FOR UPDATE;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'La ruta de retiro % no existe', p_route_id USING ERRCODE = 'P0002';
  END IF;
  IF v_route.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Solo puede reabrirse una ruta en tránsito; % está en estado %',
      v_route.code, v_route.status USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;

  -- GUARD 1 — unloading has started. Rewinding now would orphan the scans
  -- already recorded; the correct move is to finish and note the discrepancy.
  IF v_rr.id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_scans FROM public.reception_scans WHERE reception_id = v_rr.id;
    IF v_scans > 0 THEN
      RAISE EXCEPTION
        'La recepción de la ruta % ya tiene % escaneo(s); complétela y registre la discrepancia en vez de reabrirla',
        v_route.code, v_scans USING ERRCODE = '55000';
    END IF;
  END IF;

  -- GUARD 2 — in_progress re-enters uniq_pickup_routes_one_active_per_driver
  -- (20260812000003). A locked-out driver is exactly the driver who has since
  -- started a replacement, so this is the likely case, not the exotic one; a
  -- raw revert would surface an opaque 23505 no UI can translate.
  -- (The per-vehicle index is absent until Task 8 — during expand, routes
  --  legitimately share a vehicle.)
  SELECT code INTO v_blocker FROM public.pickup_routes
   WHERE operator_id = v_operator AND driver_id = v_route.driver_id
     AND status = 'in_progress' AND deleted_at IS NULL AND id <> p_route_id
   LIMIT 1;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION
      'El conductor ya tiene una ruta de retiro activa (%); ciérrela o anúlela antes de reabrir %',
      v_blocker, v_route.code USING ERRCODE = '55000';
  END IF;

  -- Soft-delete. Never DELETE: audit trail and reception_scans FK must live.
  IF v_rr.id IS NOT NULL THEN
    UPDATE public.route_receptions SET deleted_at = NOW() WHERE id = v_rr.id;
  END IF;

  UPDATE public.manifests SET reception_status = NULL
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator;

  -- trg_pickup_routes_status_sync has no 'in_progress' branch: inert here.
  UPDATE public.pickup_routes
     SET status = 'in_progress', in_transit_at = NULL
   WHERE id = p_route_id AND operator_id = v_operator
  RETURNING * INTO v_route;

  RETURN v_route;
END $$;

COMMENT ON FUNCTION public.reopen_pickup_route(UUID)
  IS 'Undo a reception opened in error: route back to in_progress, in_transit_at cleared, manifests un-flagged, batch soft-deleted (spec-52). Refuses once reception_scans exist or when the driver already has a replacement active route. Reception/operations only.';

-- PART 4 — Grants
GRANT EXECUTE ON FUNCTION public.open_route_reception(UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_pickup_route(UUID)   TO authenticated;
REVOKE ALL ON FUNCTION public.open_route_reception(UUID)  FROM anon;
REVOKE ALL ON FUNCTION public.reopen_pickup_route(UUID)   FROM anon;

-- =============================================================================
-- PART 5 — Expand-phase post-conditions
-- =============================================================================
-- Fail the deploy if someone lands the contract phase early.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'close_pickup_route') THEN
    RAISE EXCEPTION 'close_pickup_route is gone — it must survive the expand phase or drivers lose the only path to reception (spec-52 Task 8 drops it)';
  END IF;
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'trg_pickup_routes_set_manifest_reception_status')
     NOT LIKE '%route_receptions%' THEN
    RAISE EXCEPTION 'the -> in_transit branch of trg_pickup_routes_status_sync was removed; close_pickup_route would return no batch (spec-52 Task 8 owns that removal)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.pickup_scans'::regclass
                    AND tgname = 'trg_pickup_scans_route_lock') THEN
    RAISE EXCEPTION 'trg_pickup_scans_route_lock was not created';
  END IF;
  RAISE NOTICE '✓ spec-52 Task 5 expand-phase post-conditions passed';
END $$;

COMMIT;
