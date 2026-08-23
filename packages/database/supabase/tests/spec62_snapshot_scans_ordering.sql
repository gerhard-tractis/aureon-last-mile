-- spec62_snapshot_scans_ordering.sql
--
-- Pins that `scans` in public.get_route_reception_snapshot(UUID) is returned
-- in ascending `scanned_at` order, with `id` as a stable tiebreaker.
--
-- WHY THIS FILE EXISTS. The `v_scans` CTE aggregated public.reception_scans
-- with no ORDER BY, so its row order was whatever the planner produced --
-- unspecified, and free to change between calls. The mobile unloading screen
-- originally rendered scan history with `[...scans].reverse()`, assuming
-- chronological rows; a code review caught it and the frontend now sorts
-- explicitly on `scanned_at`. That fixed the live bug but left the ordering
-- an implicit contract. This test makes it an explicit, asserted one, at the
-- source, so a future reviewer (or a future rewrite of this RPC) cannot lose
-- it silently.
--
-- A test that merely inserted scans in chronological order and asserted the
-- result matched would pass whether or not an ORDER BY existed, whenever the
-- planner happens to preserve insertion order (as it typically does for a
-- small, unindexed scan on one table) -- proving nothing. So scans are
-- inserted DELIBERATELY OUT OF chronological order below, with explicit
-- `scanned_at` timestamps supplied (not NOW() at insert time, which would
-- follow insertion order by construction). Without `ORDER BY rs.scanned_at,
-- rs.id` in the RPC, the returned array would come back in insertion order --
-- i.e. NOT sorted by scanned_at -- and the assertion below would fail.
--
-- Two scans share the same `scanned_at` (a double-tap in the same instant),
-- pinning the `id` tiebreaker: without it, those two rows are free to swap
-- position between calls even with `ORDER BY scanned_at` alone.
--
-- The route is built through the real RPCs (start_pickup_route ->
-- add_manifest_to_route -> pickup scans -> open_route_reception -> reception
-- scans), matching route_reception_snapshot_contract.sql's approach: the
-- snapshot must come from data production code paths produce.

BEGIN;

-- Fixtures. Own operator/ids (…900) so this file never collides with
-- route_reception_snapshot_contract.sql's fixtures (…813) when both run
-- against the same database.
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000900','Scan Order Contract','scan-order-contract')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000900','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver@scanorder.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000900"}'::jsonb, '{"full_name":"Driver Orden"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000900','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recepcion@scanorder.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000900"}'::jsonb, '{"full_name":"Recepcionista Orden"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000900','aaaaaaaa-0000-4000-a000-000000000900','driver@scanorder.test','Driver Orden',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000900','aaaaaaaa-0000-4000-a000-000000000900','recepcion@scanorder.test','Recepcionista Orden',ARRAY['reception'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id,
  full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000900','aaaaaaaa-0000-4000-a000-000000000900','ORD-900', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, retailer_name,
                           customer_phone, delivery_address, comuna, delivery_date,
                           raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000900','aaaaaaaa-0000-4000-a000-000000000900','ORD-SCANORDER-900','Cliente Orden','Easy','+56912345678','Addr 900','Santiago', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('dddddddd-0000-4000-d000-000000000900','aaaaaaaa-0000-4000-a000-000000000900','cccccccc-0000-4000-c000-000000000900','PKG-ORD-1','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000901','aaaaaaaa-0000-4000-a000-000000000900','cccccccc-0000-4000-c000-000000000900','PKG-ORD-2','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, retailer_name, status)
VALUES ('eeeeeeee-0000-4000-e000-000000000900','aaaaaaaa-0000-4000-a000-000000000900','CARGA-ORD-900','Easy','in_progress')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Build the route through the real RPCs, as the driver
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000900","operator_id":"aaaaaaaa-0000-4000-a000-000000000900","role":"authenticated"}',
  true);

CREATE TEMP TABLE ord_ctx (route_id UUID, rr_id UUID);

DO $$
DECLARE v_route public.pickup_routes;
BEGIN
  v_route := public.start_pickup_route('ORD-900');
  PERFORM public.add_manifest_to_route(v_route.id, 'eeeeeeee-0000-4000-e000-000000000900'::UUID);
  INSERT INTO ord_ctx (route_id) VALUES (v_route.id);

  INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
  VALUES
    ('aaaaaaaa-0000-4000-a000-000000000900','eeeeeeee-0000-4000-e000-000000000900','dddddddd-0000-4000-d000-000000000900','PKG-ORD-1','verified', NOW()),
    ('aaaaaaaa-0000-4000-a000-000000000900','eeeeeeee-0000-4000-e000-000000000900','dddddddd-0000-4000-d000-000000000901','PKG-ORD-2','verified', NOW());
END $$;

-- The receptionist opens the batch.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-b000-000000000900","operator_id":"aaaaaaaa-0000-4000-a000-000000000900","role":"authenticated"}',
  true);

DO $$
DECLARE v_rr public.route_receptions;
BEGIN
  v_rr := public.open_route_reception((SELECT route_id FROM ord_ctx));
  UPDATE ord_ctx SET rr_id = v_rr.id;
END $$;

-- ---------------------------------------------------------------------------
-- Reception scans inserted DELIBERATELY OUT OF chronological order, with
-- explicit scanned_at values so the RPC cannot fall back on insertion order
-- (which NOW()-at-insert-time would otherwise coincide with). Barcodes 'A'
-- through 'D' are named for their intended chronological rank, not their
-- insert order, so a passing assertion means the RPC actually re-sorted them.
--
-- 'C1' and 'C2' share the exact same scanned_at, pinning the `id` tiebreaker:
-- with `ORDER BY scanned_at` alone (no `id`), these two rows are free to swap
-- between calls.
-- ---------------------------------------------------------------------------
INSERT INTO public.reception_scans
  (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
VALUES
  -- Inserted 1st, chronologically 3rd.
  ((SELECT rr_id FROM ord_ctx), 'dddddddd-0000-4000-d000-000000000900',
   'aaaaaaaa-0000-4000-a000-000000000900', 'SCAN-D-LAST', 'received', '2026-08-01 12:00:03+00'),
  -- Inserted 2nd, chronologically 1st.
  ((SELECT rr_id FROM ord_ctx), 'dddddddd-0000-4000-d000-000000000901',
   'aaaaaaaa-0000-4000-a000-000000000900', 'SCAN-A-FIRST', 'received', '2026-08-01 12:00:00+00'),
  -- Inserted 3rd, tied for chronologically 2nd with the next row.
  ((SELECT rr_id FROM ord_ctx), NULL,
   'aaaaaaaa-0000-4000-a000-000000000900', 'SCAN-C1-TIED', 'not_found', '2026-08-01 12:00:01+00'),
  -- Inserted 4th, tied with the previous row -- id must break the tie.
  ((SELECT rr_id FROM ord_ctx), NULL,
   'aaaaaaaa-0000-4000-a000-000000000900', 'SCAN-C2-TIED', 'route_mismatch', '2026-08-01 12:00:01+00');

-- ---------------------------------------------------------------------------
-- Assertion: `scans` comes back ascending by scanned_at, with the tied pair
-- ordered by id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_snap       JSONB;
  v_scans      JSONB;
  v_barcodes   TEXT[];
  v_timestamps TIMESTAMPTZ[];
  v_c1_id      UUID;
  v_c2_id      UUID;
  v_c1_pos     INT;
  v_c2_pos     INT;
  i            INT;
BEGIN
  v_snap  := public.get_route_reception_snapshot((SELECT route_id FROM ord_ctx));
  v_scans := v_snap -> 'scans';

  IF jsonb_array_length(v_scans) <> 4 THEN
    RAISE EXCEPTION 'expected 4 scans, got %', jsonb_array_length(v_scans);
  END IF;

  SELECT array_agg(s ->> 'barcode') INTO v_barcodes
    FROM jsonb_array_elements(v_scans) s;

  -- The two tied rows may legally land in either relative order depending on
  -- the id tiebreaker, so this asserts the STRICT positions that do not
  -- depend on which of C1/C2 sorts first: A-FIRST at position 1, D-LAST at
  -- position 4, and both C rows in the middle two positions.
  IF v_barcodes[1] <> 'SCAN-A-FIRST' THEN
    RAISE EXCEPTION
      'scans[0] must be the earliest scanned_at (SCAN-A-FIRST), got %. Full order: %. '
      'This fails if the ORDER BY on v_scans is removed.', v_barcodes[1], v_barcodes;
  END IF;
  IF v_barcodes[4] <> 'SCAN-D-LAST' THEN
    RAISE EXCEPTION
      'scans[3] must be the latest scanned_at (SCAN-D-LAST), got %. Full order: %. '
      'This fails if the ORDER BY on v_scans is removed.', v_barcodes[4], v_barcodes;
  END IF;
  IF NOT (v_barcodes[2] IN ('SCAN-C1-TIED','SCAN-C2-TIED') AND v_barcodes[3] IN ('SCAN-C1-TIED','SCAN-C2-TIED')
          AND v_barcodes[2] <> v_barcodes[3]) THEN
    RAISE EXCEPTION
      'scans[1] and scans[2] must be the two tied-timestamp rows (SCAN-C1-TIED, SCAN-C2-TIED in some order), got %',
      v_barcodes;
  END IF;

  -- scanned_at must itself be monotonically non-decreasing across the whole
  -- array -- the direct, timestamp-level version of the same assertion.
  SELECT array_agg((s ->> 'scanned_at')::timestamptz) INTO v_timestamps
    FROM jsonb_array_elements(v_scans) s;
  FOR i IN 1..3 LOOP
    IF v_timestamps[i] > v_timestamps[i+1] THEN
      RAISE EXCEPTION
        'scans is not ascending by scanned_at: position % (%) is after position % (%)',
        i, v_timestamps[i], i+1, v_timestamps[i+1];
    END IF;
  END LOOP;

  -- Tiebreaker: among the two tied rows, ascending scans[] position must
  -- match ascending `id`. Without `id` in the ORDER BY this is unpinned and
  -- could flip between calls.
  SELECT id INTO v_c1_id FROM public.reception_scans WHERE barcode = 'SCAN-C1-TIED';
  SELECT id INTO v_c2_id FROM public.reception_scans WHERE barcode = 'SCAN-C2-TIED';

  SELECT (idx - 1) INTO v_c1_pos
    FROM jsonb_array_elements(v_scans) WITH ORDINALITY AS t(s, idx)
   WHERE t.s ->> 'barcode' = 'SCAN-C1-TIED';
  SELECT (idx - 1) INTO v_c2_pos
    FROM jsonb_array_elements(v_scans) WITH ORDINALITY AS t(s, idx)
   WHERE t.s ->> 'barcode' = 'SCAN-C2-TIED';

  IF (v_c1_id < v_c2_id) <> (v_c1_pos < v_c2_pos) THEN
    RAISE EXCEPTION
      'tied-timestamp rows are not ordered by id: SCAN-C1-TIED id=% pos=%, SCAN-C2-TIED id=% pos=%',
      v_c1_id, v_c1_pos, v_c2_id, v_c2_pos;
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
