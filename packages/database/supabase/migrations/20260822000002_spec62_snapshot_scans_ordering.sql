-- =============================================================================
-- spec-62 gap fix — `scans` in the reception snapshot has a guaranteed order
-- =============================================================================
-- The `v_scans` CTE in this RPC aggregated public.reception_scans with no
-- ORDER BY, so the array's row order was whatever the planner happened to
-- produce -- unspecified, and free to change between calls or PostgreSQL
-- versions. The mobile unloading screen originally rendered scan history
-- with `[...scans].reverse()`, silently assuming chronological rows; a code
-- review caught it and the frontend now sorts explicitly on `scanned_at`
-- (apps/frontend, reception unloading screen). That fixed the live bug, but
-- left the contract implicit: every future consumer of `scans` would have to
-- independently discover it must sort.
--
-- The same migration that introduced this RPC's discrepancies CTE did add
-- `ORDER BY rs.scanned_at` there (see `v_discrepancies` below, unchanged).
-- Its omission on `v_scans` reads as an oversight, not a decision -- the two
-- CTEs share the same join and the same table. This migration closes that
-- gap by ordering `v_scans` the same way, so the frontend's sort becomes
-- belt-and-braces rather than load-bearing.
--
-- `scanned_at` alone is not deterministic: two scans landing in the same
-- millisecond (a receptionist double-tap, or a batch of inserts in one
-- transaction, as in the test data itself) would still be free to swap
-- between calls. `id` is added as a stable tiebreaker: it is a
-- gen_random_uuid() primary key, so it does not reflect insertion order and
-- the relative order of tied rows is arbitrary -- but it is fixed once a row
-- exists, so the full ORDER BY still makes row order a function of the data,
-- not of the query plan. That is the property this test pins: not WHICH of
-- two tied rows sorts first, but that the same one does, every time.
--
-- TEMPLATED ON THE LATEST DEFINITION: 20260813000005_spec52_snapshot_driver_name.sql
-- (CLAUDE.md's CREATE OR REPLACE rule: always the latest.) Everything below is
-- byte-for-byte 20260813000005 except the `v_scans` SELECT, which gains an
-- ORDER BY.
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

  -- The users join and the `driver_name` key. Operator scoping, the
  -- deleted_at filter and the not-found raise below are unchanged. The users
  -- join needs no operator predicate of its own -- `pr.operator_id = v_operator`
  -- already fences the driving row, and `pickup_routes.driver_id` is FK-bound
  -- to a user of that same operator.
  SELECT to_jsonb(pr.*) || jsonb_build_object('plate', v.plate,
                                              'driver_name', u.full_name)
    INTO v_route
    FROM public.pickup_routes pr
    LEFT JOIN public.vehicles v ON v.id = pr.vehicle_id
    LEFT JOIN public.users    u ON u.id = pr.driver_id
   WHERE pr.id = p_route_id AND pr.operator_id = v_operator AND pr.deleted_at IS NULL;
  IF v_route IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;

  -- `unexpected_count` (20260812000006) reaches the frontend through this
  -- passthrough with no change here -- genuinely a column, unlike driver_name.
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

  -- ORDER BY added here (spec-62): `to_jsonb(rs.*)` passthrough carried no
  -- ordering, so the array's row order was unspecified and could shuffle
  -- between calls. `scanned_at` gives chronological order; `id` is a stable
  -- tiebreaker for scans sharing a timestamp (e.g. a batch inserted in one
  -- transaction), so identical-looking rows can't swap position across calls.
  -- jsonb_agg needs an explicit ORDER BY inside the aggregate -- an ORDER BY
  -- on the outer SELECT would not apply, since there is only one output row.
  SELECT COALESCE(jsonb_agg(to_jsonb(rs.*) ORDER BY rs.scanned_at, rs.id), '[]'::jsonb) INTO v_scans
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
     'one without the other. `route.plate` is joined from vehicles and '
     '`route.driver_name` from users.full_name (spec-52) — neither is a column '
     'on pickup_routes; route.vehicle_label is a deprecated expand-phase '
     'mirror, do not read it. `scans` is ordered by scanned_at, id (spec-62) -- '
     'do not remove that ORDER BY; the frontend sort exists only as a second '
     'line of defence on top of it.';

GRANT EXECUTE ON FUNCTION public.get_route_reception_snapshot(UUID) TO authenticated;
