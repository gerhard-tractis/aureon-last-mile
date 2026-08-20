-- route_reception_snapshot_contract.sql
--
-- Pins the JSON contract of public.get_route_reception_snapshot(UUID) against
-- `RouteReceptionSnapshot` in
-- apps/frontend/src/hooks/reception/useRouteReceptionSnapshot.ts.
--
-- WHY THIS FILE EXISTS. From 2026-06-25 to 2026-08-13 the RPC returned
-- 'reception' / 'packages' and no 'discrepancies', while the only consumer read
-- `snapshot.route_reception.expected_count` IN JSX. The page threw TypeError on
-- render for every route, in production, for six months. Nothing asserted the
-- RPC's key set, and the page's unit test mocked the hook with a hand-written
-- object using the CORRECT keys -- so the component was validated against a
-- fiction. Hence EXACT key-set assertions: a presence-only test would have
-- missed the rename, since the renamed key was still "a key that was there".
--
-- EXACT for the top level and for `expected_packages` / `discrepancies`
-- elements -- hand-built projections, so drift either way is a contract break.
-- PRESENCE only for `route`, `route_reception`, `manifests` and `scans`
-- elements -- `to_jsonb(t.*)` passthroughs, intentionally supersets: adding a
-- column must not fail, dropping one the frontend reads must.
--
-- The route is built through the real RPCs (start_pickup_route ->
-- add_manifest_to_route -> pickup scans -> open_route_reception -> reception
-- scans), so the snapshot comes from data production code paths produce.

BEGIN;

-- Fixtures
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000813','Snapshot Contract','snapshot-contract')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000813','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver@snapcontract.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000813"}'::jsonb, '{"full_name":"Driver Contrato"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000813','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recepcion@snapcontract.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000813"}'::jsonb, '{"full_name":"Recepcionista Contrato"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows.
-- The driver holds 'pickup' and the receptionist 'reception' -- open_route_reception
-- enforces that separation of duties. The driver is `pickup_leader`: spec-61
-- Task 2 gates start_pickup_route() to pickup_leader/operations_manager/
-- admin/super_admin, and this driver calls it directly below (line ~84) --
-- pickup_crew default would fail that call with the leader refusal before
-- this file's real subject, the snapshot's JSON contract, is ever reached.
-- The receptionist's role is untouched (stays the pickup_crew table
-- default): she never calls start_pickup_route, so the gate never sees her,
-- and open_route_reception checks the 'reception' PERMISSION, not role.
INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000813','aaaaaaaa-0000-4000-a000-000000000813','pickup_leader','driver@snapcontract.test','Driver Contrato',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000813','aaaaaaaa-0000-4000-a000-000000000813','pickup_crew','recepcion@snapcontract.test','Recepcionista Contrato',ARRAY['reception'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id,
  role = EXCLUDED.role, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000813','aaaaaaaa-0000-4000-a000-000000000813','SNAP-813', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, retailer_name,
                           customer_phone, delivery_address, comuna, delivery_date,
                           raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000813','aaaaaaaa-0000-4000-a000-000000000813','ORD-SNAP-813','Cliente Contrato','Easy','+56912345678','Addr 813','Santiago', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('dddddddd-0000-4000-d000-000000000813','aaaaaaaa-0000-4000-a000-000000000813','cccccccc-0000-4000-c000-000000000813','PKG-SNAP-1','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000814','aaaaaaaa-0000-4000-a000-000000000813','cccccccc-0000-4000-c000-000000000813','PKG-SNAP-2','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, retailer_name, status)
VALUES ('eeeeeeee-0000-4000-e000-000000000813','aaaaaaaa-0000-4000-a000-000000000813','CARGA-SNAP-813','Easy','in_progress')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Build the route through the real RPCs, as the driver
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000813","operator_id":"aaaaaaaa-0000-4000-a000-000000000813","role":"authenticated"}',
  true);

CREATE TEMP TABLE snap_ctx (route_id UUID, rr_id UUID);

DO $$
DECLARE v_route public.pickup_routes;
BEGIN
  v_route := public.start_pickup_route('SNAP-813');
  PERFORM public.add_manifest_to_route(v_route.id, 'eeeeeeee-0000-4000-e000-000000000813'::UUID);
  INSERT INTO snap_ctx (route_id) VALUES (v_route.id);

  -- Two verified pickup scans => two expected packages in the snapshot.
  INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
  VALUES
    ('aaaaaaaa-0000-4000-a000-000000000813','eeeeeeee-0000-4000-e000-000000000813','dddddddd-0000-4000-d000-000000000813','PKG-SNAP-1','verified', NOW()),
    ('aaaaaaaa-0000-4000-a000-000000000813','eeeeeeee-0000-4000-e000-000000000813','dddddddd-0000-4000-d000-000000000814','PKG-SNAP-2','verified', NOW());
END $$;

-- The receptionist opens the batch.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-b000-000000000813","operator_id":"aaaaaaaa-0000-4000-a000-000000000813","role":"authenticated"}',
  true);

DO $$
DECLARE v_rr public.route_receptions;
BEGIN
  v_rr := public.open_route_reception((SELECT route_id FROM snap_ctx));
  UPDATE snap_ctx SET rr_id = v_rr.id;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 1 -- `discrepancies` is [] and NOT null when nothing has failed.
-- Runs BEFORE any reception scan exists: `[]` vs `null` is only observable
-- here, and the frontend maps over it unguarded.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_d JSONB; v_snap JSONB;
BEGIN
  v_snap := public.get_route_reception_snapshot((SELECT route_id FROM snap_ctx));
  IF NOT v_snap ? 'discrepancies' THEN
    RAISE EXCEPTION 'snapshot has no `discrepancies` key at all (keys: %)',
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_snap) k);
  END IF;
  v_d := v_snap -> 'discrepancies';
  IF jsonb_typeof(v_d) <> 'array' OR v_d <> '[]'::jsonb THEN
    RAISE EXCEPTION '`discrepancies` should be the empty ARRAY with no failed scans, got % (%)',
      v_d, jsonb_typeof(v_d);
  END IF;
END $$;

-- Now scan one of each result, so `discrepancies` is pinned by SEMANTICS and
-- not merely by "the key exists". One accepted; one barcode belonging to no
-- package on this route; one belonging to another route; and one duplicate --
-- the receptionist double-tapping a package already scanned.
INSERT INTO public.reception_scans
  (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
VALUES
  ((SELECT rr_id FROM snap_ctx), 'dddddddd-0000-4000-d000-000000000813',
   'aaaaaaaa-0000-4000-a000-000000000813', 'PKG-SNAP-1', 'received', NOW()),
  ((SELECT rr_id FROM snap_ctx), NULL,
   'aaaaaaaa-0000-4000-a000-000000000813', 'BOGUS-404', 'not_found', NOW()),
  ((SELECT rr_id FROM snap_ctx), NULL,
   'aaaaaaaa-0000-4000-a000-000000000813', 'OTHER-ROUTE-9', 'route_mismatch', NOW()),
  ((SELECT rr_id FROM snap_ctx), 'dddddddd-0000-4000-d000-000000000813',
   'aaaaaaaa-0000-4000-a000-000000000813', 'PKG-SNAP-1', 'duplicate', NOW());

-- ---------------------------------------------------------------------------
-- CASE 2 -- EXACT top-level key set. This is the assertion whose absence let
-- the six-month outage through.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_snap     JSONB;
  v_actual   TEXT[];
  v_expected TEXT[] := ARRAY['discrepancies','expected_packages','manifests',
                             'route','route_reception','scans'];
BEGIN
  v_snap := public.get_route_reception_snapshot((SELECT route_id FROM snap_ctx));

  SELECT array_agg(k ORDER BY k) INTO v_actual FROM jsonb_object_keys(v_snap) k;

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      'top-level key set does not match RouteReceptionSnapshot. got % / expected % (missing: %, unexpected: %)',
      v_actual, v_expected,
      (SELECT COALESCE(array_agg(e), '{}') FROM unnest(v_expected) e WHERE NOT e = ANY(v_actual)),
      (SELECT COALESCE(array_agg(a), '{}') FROM unnest(v_actual) a WHERE NOT a = ANY(v_expected));
  END IF;
END $$;

-- CASE 3 -- inner shape of every array, and of the two objects.
DO $$
DECLARE
  v_snap    JSONB;
  v_el      JSONB;
  v_keys    TEXT[];
  v_want    TEXT[];
  v_missing TEXT[];
  v_rec     RECORD;
BEGIN
  v_snap := public.get_route_reception_snapshot((SELECT route_id FROM snap_ctx));

  -- expected_packages -- EXACT. RouteReceptionExpectedPackage requires
  -- { id, label, order_id, order_number, manifest_id, status }; customer_name
  -- and retailer_name are pre-existing extras the RPC has always emitted.
  IF jsonb_array_length(v_snap -> 'expected_packages') <> 2 THEN
    RAISE EXCEPTION 'expected 2 expected_packages, got %',
      jsonb_array_length(v_snap -> 'expected_packages');
  END IF;
  v_el := v_snap -> 'expected_packages' -> 0;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_el) k;
  v_want := ARRAY['customer_name','id','label','manifest_id','order_id',
                  'order_number','retailer_name','status'];
  IF v_keys IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'expected_packages element shape drifted: got % / expected %',
      v_keys, v_want;
  END IF;

  -- The `id` alias is load-bearing, not cosmetic: ConsolidatedScanList.tsx
  -- keys each package row on `pkg.id` and marks it received by testing
  -- `receivedPackageIds.has(pkg.id)` against reception_scans.package_id.
  -- While the RPC emitted `package_id`, `pkg.id` was undefined and no package
  -- could ever tick green. Assert the join actually closes.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_snap -> 'expected_packages') p
     WHERE p ->> 'id' = 'dddddddd-0000-4000-d000-000000000813'
  ) THEN
    RAISE EXCEPTION 'no expected_packages element carries the scanned package id under `id`: %',
      v_snap -> 'expected_packages';
  END IF;

  -- discrepancies -- EXACT shape AND exact semantics. A discrepancy is one IN
  -- THE GOODS: not_found (barcode belongs to no package on this route) or
  -- route_mismatch (belongs to another route). `duplicate` is NOT one -- it is
  -- the receptionist scanning the same package twice, so nothing is missing and
  -- nothing extra arrived. Widening to `scan_result <> 'received'` would inflate
  -- the count with an operator double-tap; these assertions stop that coming
  -- back. Mirrors ConsolidatedScanList.tsx:74.
  IF jsonb_array_length(v_snap -> 'discrepancies') <> 2 THEN
    RAISE EXCEPTION
      'expected exactly 2 discrepancies (not_found + route_mismatch; the duplicate must NOT count), got %: %',
      jsonb_array_length(v_snap -> 'discrepancies'), v_snap -> 'discrepancies';
  END IF;

  v_el := v_snap -> 'discrepancies' -> 0;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_el) k;
  IF v_keys IS DISTINCT FROM ARRAY['barcode','scanned_at'] THEN
    RAISE EXCEPTION 'discrepancies element shape drifted: got % / expected {barcode,scanned_at}', v_keys;
  END IF;
  IF v_el ->> 'scanned_at' IS NULL THEN
    RAISE EXCEPTION 'discrepancy scanned_at is null';
  END IF;

  SELECT array_agg(d ->> 'barcode' ORDER BY d ->> 'barcode') INTO v_keys
    FROM jsonb_array_elements(v_snap -> 'discrepancies') d;
  IF v_keys IS DISTINCT FROM ARRAY['BOGUS-404','OTHER-ROUTE-9'] THEN
    RAISE EXCEPTION
      'discrepancies must be exactly the not_found and route_mismatch barcodes, got %', v_keys;
  END IF;

  -- Stated as its own assertion so the failure message names the actual rule.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_snap -> 'discrepancies') d
     WHERE d ->> 'barcode' = 'PKG-SNAP-1'
  ) THEN
    RAISE EXCEPTION
      'a `duplicate` scan leaked into discrepancies -- a double-tap is not a discrepancy in the goods (see ConsolidatedScanList.tsx:74): %',
      v_snap -> 'discrepancies';
  END IF;

  -- ...but the duplicate IS still a scan, so it must be in `scans`. This is
  -- what makes discrepancies a strict SUBSET rather than a different query.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_snap -> 'scans') s
     WHERE s ->> 'scan_result' = 'duplicate'
  ) THEN
    RAISE EXCEPTION 'the duplicate scan is missing from `scans`: %', v_snap -> 'scans';
  END IF;

  -- Cardinality of the passthrough collections.
  IF jsonb_array_length(v_snap -> 'scans') <> 4 THEN
    RAISE EXCEPTION 'expected 4 scans, got %', jsonb_array_length(v_snap -> 'scans');
  END IF;
  IF jsonb_array_length(v_snap -> 'manifests') <> 1 THEN
    RAISE EXCEPTION 'expected 1 manifest, got %', jsonb_array_length(v_snap -> 'manifests');
  END IF;
  IF jsonb_typeof(v_snap -> 'route_reception') <> 'object' THEN
    RAISE EXCEPTION '`route_reception` must be an object for an opened batch, got %',
      jsonb_typeof(v_snap -> 'route_reception');
  END IF;

  -- PRESENCE of every interface field on the `to_jsonb(t.*)` passthroughs.
  -- Supersets are fine here; a dropped or renamed field the frontend reads
  -- is not.
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('RouteReceptionScan (scans[0])',          v_snap -> 'scans' -> 0,
       ARRAY['id','barcode','scan_result','package_id','scanned_at']),
      ('RouteReceptionManifest (manifests[0])',  v_snap -> 'manifests' -> 0,
       ARRAY['id','external_load_id','retailer_name']),
      ('RouteReceptionRouteHeader (route)',      v_snap -> 'route',
       ARRAY['id','code','driver_id','driver_name','status','in_transit_at','plate']),
      ('route_reception (read in page.tsx JSX)', v_snap -> 'route_reception',
       ARRAY['id','status','expected_count','received_count','unexpected_count',
             'started_at','completed_at','discrepancy_notes'])
    ) AS t(label, node, want)
  LOOP
    SELECT COALESCE(array_agg(w), '{}') INTO v_missing
      FROM unnest(v_rec.want) w WHERE NOT v_rec.node ? w;
    IF v_missing <> '{}' THEN
      RAISE EXCEPTION '% is missing interface fields %: %', v_rec.label, v_missing, v_rec.node;
    END IF;
  END LOOP;

  IF (v_snap -> 'route_reception' ->> 'expected_count')::INT <> 2 THEN
    RAISE EXCEPTION 'route_reception.expected_count should be 2, got %',
      v_snap -> 'route_reception' ->> 'expected_count';
  END IF;

  -- spec-52 -- `route.plate` is the JOINED vehicles.plate, and presence alone
  -- is not enough: the key could exist and be NULL if the join were wrong, and
  -- the header would render a blank truck for every route. Assert the VALUE.
  -- The route was started via start_pickup_route('SNAP-813'), which binds the
  -- vehicle inserted above.
  IF v_snap -> 'route' ->> 'plate' IS DISTINCT FROM 'SNAP-813' THEN
    RAISE EXCEPTION
      'route.plate must be the joined vehicles.plate (expected SNAP-813), got %. route node: %',
      v_snap -> 'route' ->> 'plate', v_snap -> 'route';
  END IF;

  -- spec-52 -- `route.driver_name` is the JOINED users.full_name. `pickup_routes`
  -- has NO driver_name column, so while the route node was a bare `to_jsonb(pr.*)`
  -- the key was simply absent and RouteReceptionHeader's `{driverName && ...}`
  -- guard hid the whole driver line -- silently, for every route, since spec-47.
  -- The presence list above is what stops it going dead again; the value check
  -- here is what stops the join being wired to the wrong column, which presence
  -- alone cannot see. The route was started by 'Driver Contrato' above.
  IF v_snap -> 'route' ->> 'driver_name' IS DISTINCT FROM 'Driver Contrato' THEN
    RAISE EXCEPTION
      'route.driver_name must be the joined users.full_name (expected Driver Contrato), got %. route node: %',
      v_snap -> 'route' ->> 'driver_name', v_snap -> 'route';
  END IF;

  -- spec-52 -- unexpected_count rides through `to_jsonb(rr.*)` with no code in
  -- the RPC. Pinned here so dropping the column (or the passthrough) fails
  -- loudly: FinalizeReceptionButton computes `matched := received - unexpected`
  -- and a missing value would silently become NaN, collapsing the notes rule
  -- back to the one that lets an absent and an extra package cancel out.
  -- Every scan above is a package with a verified pickup scan on this route,
  -- so nothing here is unexpected.
  IF (v_snap -> 'route_reception' ->> 'unexpected_count')::INT <> 0 THEN
    RAISE EXCEPTION 'route_reception.unexpected_count should be 0, got %',
      v_snap -> 'route_reception' ->> 'unexpected_count';
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
