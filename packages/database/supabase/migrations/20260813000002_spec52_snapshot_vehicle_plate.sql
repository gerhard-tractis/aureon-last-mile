-- =============================================================================
-- spec-52 Task 11 — the reception snapshot returns the vehicle's real plate
-- =============================================================================
-- spec-52 moved the truck's identity off `pickup_routes.vehicle_label` (free
-- text, typed by the driver, never validated) onto `vehicle_id -> vehicles.plate`.
-- `start_pickup_route` still MIRRORS the plate into `vehicle_label` during the
-- expand phase so the pre-switch UI does not go blank, but the mirror is
-- write-only from the frontend's point of view and is dropped in the contract
-- phase. Every read site must therefore read the joined plate.
--
-- The route node of the snapshot was `to_jsonb(pr.*)`, which carries
-- `vehicle_id` but no plate — the UI cannot resolve it without a second
-- round-trip, which is the one thing this single-roundtrip RPC exists to avoid.
--
-- TEMPLATED ON THE LATEST DEFINITION: 20260813000001_fix_route_reception_snapshot_contract.sql
-- (NOT the spec-47 original 20260625000001:493, which returned the pre-#398 key
-- names and would silently revert that fix — CLAUDE.md's CREATE OR REPLACE
-- rule). Everything below is byte-for-byte that migration except the `v_route`
-- SELECT, which gains the LEFT JOIN and the `plate` merge.
--
-- LEFT JOIN, not JOIN: a route whose vehicle row was deleted must still be
-- receivable. `plate` then comes back NULL, which is exactly what
-- `RouteReceptionRouteHeader.plate: string | null` declares.
--
-- `to_jsonb(pr.*) || jsonb_build_object(...)` keeps `route` a superset
-- passthrough, so the deprecated `vehicle_label` still rides along untouched
-- for anything mid-deploy — the contract test asserts PRESENCE, not an exact
-- key set, on this node precisely so additive changes like this one are legal.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_route_reception_snapshot(
  p_route_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator       UUID;
  v_route          JSONB;
  v_rr             JSONB;
  v_manifests      JSONB;
  v_packages       JSONB;
  v_scans          JSONB;
  v_discrepancies  JSONB;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- The ONLY change from 20260813000001: the vehicle join and the `plate` key.
  -- Operator scoping, the deleted_at filter and the not-found raise below are
  -- unchanged.
  SELECT to_jsonb(pr.*) || jsonb_build_object('plate', v.plate) INTO v_route
    FROM public.pickup_routes pr
    LEFT JOIN public.vehicles v ON v.id = pr.vehicle_id
   WHERE pr.id = p_route_id AND pr.operator_id = v_operator AND pr.deleted_at IS NULL;
  IF v_route IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;

  -- `unexpected_count` (20260812000006) reaches the frontend through this
  -- passthrough with no change here — that is why Task 11 needs no SQL for it.
  SELECT to_jsonb(rr.*) INTO v_rr
    FROM public.route_receptions rr
   WHERE rr.pickup_route_id = p_route_id AND rr.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(m.*)), '[]'::jsonb) INTO v_manifests
    FROM public.manifests m
   WHERE m.pickup_route_id = p_route_id;

  -- Packages grouped via verified pickup_scans, with order context for the UI.
  -- `pk.id AS id` (was `AS package_id`) and `pk.status` align this with
  -- RouteReceptionExpectedPackage { id, label, order_id, order_number,
  -- manifest_id, status }. customer_name/retailer_name are retained: they were
  -- already emitted and dropping them would be a behaviour change beyond the
  -- contract fix.
  SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO v_packages
    FROM (
      SELECT DISTINCT
             pk.id            AS id,
             pk.label         AS label,
             pk.order_id      AS order_id,
             o.order_number   AS order_number,
             o.customer_name  AS customer_name,
             o.retailer_name  AS retailer_name,
             ps.manifest_id   AS manifest_id,
             pk.status        AS status
        FROM public.pickup_scans ps
        JOIN public.manifests m ON m.id = ps.manifest_id
        JOIN public.packages  pk ON pk.id = ps.package_id
        JOIN public.orders    o  ON o.id = pk.order_id
       WHERE m.pickup_route_id = p_route_id
         AND ps.scan_result = 'verified'
         AND ps.package_id IS NOT NULL
    ) p;

  SELECT COALESCE(jsonb_agg(to_jsonb(rs.*)), '[]'::jsonb) INTO v_scans
    FROM public.reception_scans rs
    JOIN public.route_receptions rr ON rr.id = rs.reception_id
   WHERE rr.pickup_route_id = p_route_id;

  -- Scans that represent a DISCREPANCY IN THE GOODS: a barcode that belongs to
  -- no package on this route (not_found) or to a package that belongs to a
  -- different route (route_mismatch). Shaped as RouteReceptionDiscrepancy
  -- { barcode, scanned_at }.
  --
  -- `duplicate` is DELIBERATELY EXCLUDED -- do not "fix" this asymmetry back to
  -- `<> 'received'`. A duplicate is the receptionist scanning the same package
  -- twice: nothing is missing and nothing extra arrived, so it is an operator
  -- double-tap, not a discrepancy in the shipment. Counting it would inflate
  -- the discrepancy total with an input artefact and push receptionists toward
  -- writing discrepancy_notes for a non-event.
  --
  -- This predicate intentionally mirrors ConsolidatedScanList.tsx:74
  --   scans.filter(s => s.scan_result === 'not_found' || s.scan_result === 'route_mismatch')
  -- which derives the same concept client-side from `scans`. The component is
  -- the considered, working definition; this is the server-side twin of it.
  -- If one changes, change the other in the same commit -- and update
  -- tests/route_reception_snapshot_contract.sql, which pins the duplicate case.
  --
  -- Still a strict subset of `scans` above: same join, same (absence of a)
  -- deleted_at filter, so the two can never disagree about what was scanned.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object('barcode', rs.barcode, 'scanned_at', rs.scanned_at)
             ORDER BY rs.scanned_at
           ),
           '[]'::jsonb
         ) INTO v_discrepancies
    FROM public.reception_scans rs
    JOIN public.route_receptions rr ON rr.id = rs.reception_id
   WHERE rr.pickup_route_id = p_route_id
     AND rs.scan_result IN ('not_found', 'route_mismatch');

  RETURN jsonb_build_object(
    'route',             v_route,
    'route_reception',   v_rr,
    'manifests',         v_manifests,
    'expected_packages', v_packages,
    'scans',             v_scans,
    'discrepancies',     v_discrepancies
  );
END $$;

COMMENT ON FUNCTION public.get_route_reception_snapshot(UUID)
  IS 'Single-roundtrip snapshot for the consolidated reception page (spec-47). '
     'Top-level keys are the contract of RouteReceptionSnapshot in '
     'apps/frontend/src/hooks/reception/useRouteReceptionSnapshot.ts and are '
     'pinned by tests/route_reception_snapshot_contract.sql -- do not rename '
     'one without the other. `route.plate` is joined from vehicles (spec-52); '
     'route.vehicle_label is a deprecated expand-phase mirror, do not read it.';

GRANT EXECUTE ON FUNCTION public.get_route_reception_snapshot(UUID) TO authenticated;
