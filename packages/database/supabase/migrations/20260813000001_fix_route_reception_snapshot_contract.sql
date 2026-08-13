-- =============================================================================
-- Fix: get_route_reception_snapshot() returned keys the frontend never reads
-- =============================================================================
-- SPEC-47 DEFECT, shipped 2026-06-25, invisible until spec-52 exercised it.
--
-- The only consumer of this RPC is useRouteReceptionSnapshot.ts, whose
-- `RouteReceptionSnapshot` interface IS the contract (it has several
-- component-level consumers and a richer shape). The RPC disagreed with it on
-- every axis that mattered:
--
--   RPC (before)        interface            consequence
--   ------------------  -------------------  ------------------------------------
--   'reception'         route_reception      page.tsx reads
--                                            snapshot.route_reception.expected_count
--                                            IN JSX -> TypeError on render. The
--                                            consolidated hub reception page could
--                                            not render for ANY route.
--   'packages'          expected_packages    ConsolidatedScanList received
--                                            `undefined` for expectedPackages.
--   (absent)            discrepancies        undefined array on the contract.
--                                            Defined here as not_found +
--                                            route_mismatch only, matching
--                                            ConsolidatedScanList.tsx:74 -- see
--                                            the note at the query below.
--   pk.id AS package_id  .id                 ConsolidatedScanList keys package rows
--                                            on `pkg.id` and matches them against
--                                            reception_scans.package_id. With the
--                                            wrong alias every row got key
--                                            `undefined` and `received` was never
--                                            true -- scanned packages would never
--                                            tick green even once the page loaded.
--   (absent)            .status              declared on
--                                            RouteReceptionExpectedPackage.
--
-- This migration realigns the RPC with the interface. It changes ONLY the shape
-- of the returned JSON -- every underlying query, join, filter and the operator
-- scoping/permission behaviour are byte-for-byte the ones from
-- 20260625000001_spec47_pickup_routes_consolidated_reception.sql:493, which
-- remains the latest (and only) prior definition of this function.
--
-- The contract itself is now pinned by
-- packages/database/supabase/tests/route_reception_snapshot_contract.sql, which
-- asserts the EXACT top-level key set (no missing keys, no extras) plus the
-- inner shape of each array. Nothing asserted the key set before, which is why
-- a rename survived six months in production.
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

  SELECT to_jsonb(pr.*) INTO v_route
    FROM public.pickup_routes pr
   WHERE pr.id = p_route_id AND pr.operator_id = v_operator AND pr.deleted_at IS NULL;
  IF v_route IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;

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
     'one without the other.';

GRANT EXECUTE ON FUNCTION public.get_route_reception_snapshot(UUID) TO authenticated;
