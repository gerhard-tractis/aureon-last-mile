-- spec-52 Task 6 — route_receptions.unexpected_count + the discrepancy guard
--
-- At reception the receptionist scans the truck flat; a package can arrive that
-- has NO verified pickup scan on this route. spec-52 accepts it as 'received'
-- and flags it UNEXPECTED, so received_count > expected_count is normal.
--
-- SCOPE — READ BEFORE EDITING CASES 4 AND 5. The migration adds and populates
-- unexpected_count but DOES NOT yet enforce it: complete_route_reception keeps
-- its spec-47 guard (notes required only when received_count < expected_count).
-- That deferral is deliberate and argued in full at 20260812000006 PART 3 — in
-- short, the shipped FinalizeReceptionButton opens its notes modal on
-- `received < expected` alone and cannot see unexpected_count, so tightening
-- the server guard now makes the offsetting reception UNFINISHABLE. Cases 4
-- and 5 therefore assert TODAY's behaviour, marked `TASK 8:` with what must
-- replace them when the contract phase lands the guard and the UI together.
-- They are kept, not deleted, so those scenarios stay visible.
--
-- This file pins:
--   1. a reception scan for a package WITH a verified pickup scan on this route
--      does NOT bump unexpected_count
--   2. a reception scan for a package WITHOUT one DOES
--   3. complete_route_reception demands notes on an under-count
--   4. TODAY: an over-count finalizes WITHOUT notes  (TASK 8: must demand them)
--   5. TODAY: the OFFSETTING case (10 expected / 10 received / 1 unexpected)
--      finalizes WITHOUT notes, because received_count = expected_count.
--      TASK 8: must demand them — matched = received - unexpected = 9 <> 10:
--      one expected package never arrived AND one from another truck did.
--      THIS IS THE SCENARIO THE EVENTUAL RULE EXISTS TO CATCH.
--   6. a clean batch finalizes without notes and invents none
--   7. received_count still increments in every case (spec-47 behaviour intact)
--   8. completing the batch closes the manifests (status + completed_at)
--
-- Fixture shape per route: (idx, n_expected, n_matched_received, n_unexpected)
--   route 1 — trigger unit, scanned step by step below
--   route 2 — under-count   : expected 2, received 1, unexpected 0
--   route 3 — over-count    : expected 1, received 2, unexpected 1
--   route 4 — OFFSETTING    : expected 10, received 10, unexpected 1
--   route 5 — clean         : expected 2, received 2, unexpected 0

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000560','Spec52 Unexpected','spec52-unexpected')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000561',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver@spec52unexp.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000560"}'::jsonb,
   '{"full_name":"Driver Unexp"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000562',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'recepcion@spec52unexp.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000560"}'::jsonb,
   '{"full_name":"Recepcionista Unexp"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000561','aaaaaaaa-0000-4000-a000-000000000560','driver@spec52unexp.test','Driver Unexp',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000562','aaaaaaaa-0000-4000-a000-000000000560','recepcion@spec52unexp.test','Recepcionista Unexp',ARRAY['reception'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000560','aaaaaaaa-0000-4000-a000-000000000560','VEH-UNEXP-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000560','aaaaaaaa-0000-4000-a000-000000000560',
        'ORD-UNEXP-1','Cust','+56912345678','Addr','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Route builder. Every route is created in_progress (pickup scans are only
-- accepted while the route is in_progress — trg_pickup_scans_route_lock), then
-- flipped to in_transit, which is what creates route_receptions and FREEZES
-- expected_count from the DISTINCT verified pickup scans.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec   RECORD;
  v_route UUID;
  v_man   UUID;
  v_pkg   UUID;
  v_rr    UUID;
  i       INT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      (1,  1, 0, 0),   -- trigger unit; scans are inserted by hand below
      (2,  2, 1, 0),   -- under-count
      (3,  1, 1, 1),   -- over-count
      (4, 10, 9, 1),   -- OFFSETTING: 10 expected, 10 received, 1 unexpected
      (5,  2, 2, 0)    -- clean
    ) AS t(idx, n_expected, n_matched, n_unexpected)
  LOOP
    v_route := ('11111111-0000-4000-1000-' || lpad(spec.idx::text, 12, '0'))::uuid;
    v_man   := ('eeeeeeee-0000-4000-e000-' || lpad(spec.idx::text, 12, '0'))::uuid;

    INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
    VALUES (v_route,'aaaaaaaa-0000-4000-a000-000000000560','PR-UNEXP-' || spec.idx,
            'aaaaaaaa-0000-4000-a000-000000000561','99999999-0000-4000-9000-000000000560','in_progress');

    INSERT INTO public.manifests (id, operator_id, external_load_id, status, pickup_route_id)
    VALUES (v_man,'aaaaaaaa-0000-4000-a000-000000000560','CARGA-UNEXP-' || spec.idx,'in_progress', v_route);

    -- Expected packages: verified pickup scan on THIS route.
    FOR i IN 1..spec.n_expected LOOP
      v_pkg := ('dddddddd-0000-4000-d000-' || lpad(spec.idx::text,3,'0') || lpad(i::text,9,'0'))::uuid;
      INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
      VALUES (v_pkg,'aaaaaaaa-0000-4000-a000-000000000560','cccccccc-0000-4000-c000-000000000560',
              format('PKG-%s-E%s', spec.idx, i), '[]'::jsonb, '{}'::jsonb);
      INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000560', v_man, v_pkg,
              format('PKG-%s-E%s', spec.idx, i), 'verified', NOW());
    END LOOP;

    -- Unexpected packages: physically on the truck, NEVER scanned at pickup.
    FOR i IN 1..spec.n_unexpected LOOP
      v_pkg := ('dddddddd-0000-4000-d000-' || lpad(spec.idx::text,3,'0') || lpad((900+i)::text,9,'0'))::uuid;
      INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
      VALUES (v_pkg,'aaaaaaaa-0000-4000-a000-000000000560','cccccccc-0000-4000-c000-000000000560',
              format('PKG-%s-U%s', spec.idx, i), '[]'::jsonb, '{}'::jsonb);
    END LOOP;

    UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW() WHERE id = v_route;
    SELECT id INTO v_rr FROM public.route_receptions WHERE pickup_route_id = v_route;

    FOR i IN 1..spec.n_matched LOOP
      INSERT INTO public.reception_scans (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
      VALUES (v_rr, ('dddddddd-0000-4000-d000-' || lpad(spec.idx::text,3,'0') || lpad(i::text,9,'0'))::uuid,
              'aaaaaaaa-0000-4000-a000-000000000560', format('PKG-%s-E%s', spec.idx, i), 'received', NOW());
    END LOOP;
    FOR i IN 1..spec.n_unexpected LOOP
      INSERT INTO public.reception_scans (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
      VALUES (v_rr, ('dddddddd-0000-4000-d000-' || lpad(spec.idx::text,3,'0') || lpad((900+i)::text,9,'0'))::uuid,
              'aaaaaaaa-0000-4000-a000-000000000560', format('PKG-%s-U%s', spec.idx, i), 'received', NOW());
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 1/2 + 7 — the counting trigger, scanned step by step on route 1
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_rr UUID; v_recv INT; v_unex INT;
BEGIN
  SELECT id INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = '11111111-0000-4000-1000-000000000001';

  -- The unexpected package for route 1 (no pickup scan anywhere).
  INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
  VALUES ('dddddddd-0000-4000-d000-001000000901','aaaaaaaa-0000-4000-a000-000000000560',
          'cccccccc-0000-4000-c000-000000000560','PKG-1-U1','[]'::jsonb,'{}'::jsonb);

  -- CASE 1 — package WITH a verified pickup scan on this route.
  INSERT INTO public.reception_scans (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
  VALUES (v_rr,'dddddddd-0000-4000-d000-001000000001',
          'aaaaaaaa-0000-4000-a000-000000000560','PKG-1-E1','received', NOW());

  SELECT received_count, unexpected_count INTO v_recv, v_unex
    FROM public.route_receptions WHERE id = v_rr;
  IF v_recv <> 1 THEN RAISE EXCEPTION 'received_count should be 1 after the first scan, got %', v_recv; END IF;
  IF v_unex <> 0 THEN RAISE EXCEPTION 'a package WITH a verified pickup scan must not be unexpected, got %', v_unex; END IF;

  -- CASE 2 — package WITHOUT a verified pickup scan on this route.
  INSERT INTO public.reception_scans (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
  VALUES (v_rr,'dddddddd-0000-4000-d000-001000000901',
          'aaaaaaaa-0000-4000-a000-000000000560','PKG-1-U1','received', NOW());

  SELECT received_count, unexpected_count INTO v_recv, v_unex
    FROM public.route_receptions WHERE id = v_rr;
  IF v_recv <> 2 THEN RAISE EXCEPTION 'received_count must still increment for an unexpected package, got %', v_recv; END IF;
  IF v_unex <> 1 THEN RAISE EXCEPTION 'a package with NO verified pickup scan must count as unexpected, got %', v_unex; END IF;
END $$;

-- CASE 7 — received_count / unexpected_count / expected_count across all routes
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('11111111-0000-4000-1000-000000000002'::uuid, 2,  1, 0),
      ('11111111-0000-4000-1000-000000000003'::uuid, 1,  2, 1),
      ('11111111-0000-4000-1000-000000000004'::uuid, 10,10, 1),
      ('11111111-0000-4000-1000-000000000005'::uuid, 2,  2, 0)
    ) AS t(route, exp, recv, unex)
  LOOP
    PERFORM 1 FROM public.route_receptions rr
     WHERE rr.pickup_route_id = r.route
       AND rr.expected_count = r.exp
       AND rr.received_count = r.recv
       AND rr.unexpected_count = r.unex;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'route % counters wrong: expected (%,%,%), got %', r.route, r.exp, r.recv, r.unex,
        (SELECT format('exp=%s recv=%s unex=%s', expected_count, received_count, unexpected_count)
           FROM public.route_receptions WHERE pickup_route_id = r.route);
    END IF;
  END LOOP;
END $$;

-- The receptionist's JWT — complete_route_reception is operator-scoped.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-b000-000000000562","operator_id":"aaaaaaaa-0000-4000-a000-000000000560","role":"authenticated"}',
  true);

-- ---------------------------------------------------------------------------
-- CASE 3 — an under-count still demands discrepancy notes (spec-47 guard)
-- ---------------------------------------------------------------------------
DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN PERFORM public.complete_route_reception('11111111-0000-4000-1000-000000000002'::uuid);
  EXCEPTION WHEN OTHERS THEN rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'notes must be demanded on an under-count (2 expected, 1 received)'; END IF;

  -- ...and must succeed once the receptionist explains it.
  PERFORM public.complete_route_reception('11111111-0000-4000-1000-000000000002'::uuid, 'Discrepancia registrada');
  IF (SELECT status FROM public.route_receptions
       WHERE pickup_route_id = '11111111-0000-4000-1000-000000000002') <> 'completed' THEN
    RAISE EXCEPTION 'complete_route_reception with notes must complete the under-count batch';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 4/5 — over-count and the OFFSETTING case: TODAY they finalize WITHOUT
-- notes, because the spec-47 guard only fires on received_count < expected.
--
-- TASK 8 (contract phase, with the FinalizeReceptionButton change): both must
-- FAIL without notes once complete_route_reception enforces
--     matched := received_count - unexpected_count
--     notes required when matched <> expected_count OR unexpected_count > 0
-- Then replace this loop body with the CASE 3 shape — bare call raises, call
-- with notes completes. Fixtures are already built for it: route 3 is 1/2/1
-- (matched 1, unexpected > 0), route 4 the offsetting 10/10/1 (matched 9 <>
-- 10). Do not delete these routes. Route 4 is the scenario the eventual rule
-- exists to catch AND the reason it cannot ship yet: the shipped UI compares
-- received to expected, sees 10 = 10, never opens the notes modal, and would
-- call this RPC with NULL notes forever.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c RECORD; v_rr public.route_receptions;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('11111111-0000-4000-1000-000000000003'::uuid, 'over-count (1 expected, 2 received, 1 unexpected)'),
      ('11111111-0000-4000-1000-000000000004'::uuid, 'OFFSETTING (10 expected, 10 received, 1 unexpected)')
    ) AS t(route, label)
  LOOP
    v_rr := public.complete_route_reception(c.route);
    IF v_rr.status <> 'completed' THEN
      RAISE EXCEPTION 'TODAY the spec-47 guard must let this through without notes — % (got status %)', c.label, v_rr.status;
    END IF;
    IF v_rr.discrepancy_notes IS NOT NULL THEN
      RAISE EXCEPTION 'no notes were passed, none should have been invented — % (got %)', c.label, v_rr.discrepancy_notes;
    END IF;
    -- The tally IS enforced now even though the guard is not.
    IF v_rr.unexpected_count <> 1 THEN
      RAISE EXCEPTION 'unexpected_count must be 1 — % (got %)', c.label, v_rr.unexpected_count;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — a clean batch (matched = expected, unexpected = 0) needs no notes
-- CASE 8 — completing the batch closes the manifests
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_rr public.route_receptions; v_man public.manifests;
BEGIN
  v_rr := public.complete_route_reception('11111111-0000-4000-1000-000000000005'::uuid);
  IF v_rr.status <> 'completed' THEN RAISE EXCEPTION 'a clean reception must complete without notes, got %', v_rr.status; END IF;
  IF v_rr.discrepancy_notes IS NOT NULL THEN RAISE EXCEPTION 'a clean reception must not invent notes: %', v_rr.discrepancy_notes; END IF;

  SELECT * INTO v_man FROM public.manifests
   WHERE id = 'eeeeeeee-0000-4000-e000-000000000005';
  IF v_man.reception_status IS DISTINCT FROM 'received' THEN RAISE EXCEPTION 'manifest reception_status should be received, got %', v_man.reception_status; END IF;
  IF v_man.status::text <> 'completed' THEN RAISE EXCEPTION 'manifest status should be completed, got %', v_man.status; END IF;
  IF v_man.completed_at IS NULL THEN RAISE EXCEPTION 'manifest completed_at not stamped'; END IF;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
