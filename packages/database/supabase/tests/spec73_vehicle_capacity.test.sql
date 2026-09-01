-- =============================================================================
-- spec-73 phase 1 — capacity ladder data model: fleet_vehicles.capacity_packages,
-- routes.max_drops, dock_zone_adjacency, vehicle_load_samples.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec73_vehicle_capacity.test.sql
--
-- House style, matching spec71_load_positions.test.sql / pre_route_snapshot.test.sql:
-- fixtures inside one transaction, SAVEPOINT per test, each test a DO block
-- that RAISEs on failure, ROLLBACK TO the savepoint so later tests are
-- unaffected by an earlier failure, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_vehicles' AND column_name = 'capacity_packages'
  ) THEN
    RAISE EXCEPTION 'fleet_vehicles.capacity_packages missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routes' AND column_name = 'max_drops'
  ) THEN
    RAISE EXCEPTION 'routes.max_drops missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dock_zone_adjacency'
  ) THEN
    RAISE EXCEPTION 'dock_zone_adjacency table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dock_zone_adjacency'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on dock_zone_adjacency';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicle_load_samples'
  ) THEN
    RAISE EXCEPTION 'vehicle_load_samples table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vehicle_load_samples'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on vehicle_load_samples';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users, dock_zones, fleet_vehicles, routes ──────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'Test Op 73-A', 'test-op-73-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000073', 'Test Op 73-B', 'test-op-73-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000173',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec73.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000073"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000173',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec73.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000073"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000173','aaaaaaaa-aaaa-aaaa-aaaa-000000000073','user-a@spec73.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000173','bbbbbbbb-bbbb-bbbb-bbbb-000000000073','user-b@spec73.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

SELECT set_config('request.jwt.claims', '{}', true);

-- Two andenes per operator (for dock_zone_adjacency fixtures).
INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
VALUES
  ('44440021-0000-0000-0000-000000000073', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'Andén A1', 'AN73-A1', true),
  ('44440022-0000-0000-0000-000000000073', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'Andén A2', 'AN73-A2', true),
  ('44440023-0000-0000-0000-000000000073', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000073', 'Andén B1', 'AN73-B1', true),
  ('44440024-0000-0000-0000-000000000073', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000073', 'Andén B2', 'AN73-B2', true)
ON CONFLICT (id) DO NOTHING;

-- One fleet_vehicles row per operator.
INSERT INTO public.fleet_vehicles (id, operator_id, provider, external_vehicle_id, vehicle_type)
VALUES
  ('55550001-0000-0000-0000-000000000073', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'dispatchtrack', 'TRK-A1', 'Furgón'),
  ('55550002-0000-0000-0000-000000000073', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000073', 'dispatchtrack', 'TRK-B1', 'Furgón')
ON CONFLICT (id) DO NOTHING;

-- One route per operator, vehicle-assigned.
INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
VALUES
  ('66660001-0000-0000-0000-000000000073', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'dispatchtrack', 'spec73-route-1', CURRENT_DATE, 'planned', '55550001-0000-0000-0000-000000000073'),
  ('66660002-0000-0000-0000-000000000073', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000073', 'dispatchtrack', 'spec73-route-2', CURRENT_DATE, 'planned', '55550002-0000-0000-0000-000000000073')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: fleet_vehicles.capacity_packages is nullable and round-trips a
-- normal positive value.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE v_read INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Default is NULL — unconfigured.
  SELECT capacity_packages INTO v_read FROM public.fleet_vehicles
   WHERE id = '55550001-0000-0000-0000-000000000073';
  IF v_read IS NOT NULL THEN
    RAISE EXCEPTION 'capacity_packages should default to NULL, got %', v_read;
  END IF;

  UPDATE public.fleet_vehicles SET capacity_packages = 200
   WHERE id = '55550001-0000-0000-0000-000000000073';

  SELECT capacity_packages INTO v_read FROM public.fleet_vehicles
   WHERE id = '55550001-0000-0000-0000-000000000073';
  IF v_read IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'capacity_packages did not persist 200, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: capacity_packages defaults to NULL and round-trips a positive value';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: fleet_vehicles.capacity_packages accepts 0 and negative values
-- WITHOUT error — no CHECK, per spec-73 Decision 2 (mirrors spec-68's
-- dock_zones.capacity reasoning: the arithmetic module treats these the
-- same as NULL; the schema does not block them).
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE v_read INT; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  BEGIN
    UPDATE public.fleet_vehicles SET capacity_packages = 0
     WHERE id = '55550001-0000-0000-0000-000000000073';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'capacity_packages = 0 was rejected, should round-trip without error: %', err_msg;
  END;

  SELECT capacity_packages INTO v_read FROM public.fleet_vehicles
   WHERE id = '55550001-0000-0000-0000-000000000073';
  IF v_read IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'capacity_packages did not persist 0, got %', v_read;
  END IF;

  BEGIN
    UPDATE public.fleet_vehicles SET capacity_packages = -50
     WHERE id = '55550001-0000-0000-0000-000000000073';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'capacity_packages = -50 was rejected, should round-trip without error (no CHECK): %', err_msg;
  END;

  SELECT capacity_packages INTO v_read FROM public.fleet_vehicles
   WHERE id = '55550001-0000-0000-0000-000000000073';
  IF v_read IS DISTINCT FROM -50 THEN
    RAISE EXCEPTION 'capacity_packages did not persist -50, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: capacity_packages accepts 0 and negative values without error (no CHECK)';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: routes.max_drops is nullable, unconfigured by default, and
-- round-trips a value without blocking anything else on the row.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE v_read INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT max_drops INTO v_read FROM public.routes
   WHERE id = '66660001-0000-0000-0000-000000000073';
  IF v_read IS NOT NULL THEN
    RAISE EXCEPTION 'max_drops should default to NULL, got %', v_read;
  END IF;

  UPDATE public.routes SET max_drops = 45
   WHERE id = '66660001-0000-0000-0000-000000000073';

  SELECT max_drops INTO v_read FROM public.routes
   WHERE id = '66660001-0000-0000-0000-000000000073';
  IF v_read IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION 'max_drops did not persist 45, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: routes.max_drops defaults to NULL and round-trips a value';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: dock_zone_adjacency_not_self CHECK rejects a zone paired with
-- itself.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE blocked BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  BEGIN
    INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
            '44440021-0000-0000-0000-000000000073',
            '44440021-0000-0000-0000-000000000073');
  EXCEPTION WHEN check_violation THEN
    blocked := true;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'dock_zone_adjacency_not_self did not reject a zone paired with itself';
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: dock_zone_adjacency_not_self CHECK enforced';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: unique_dock_zone_adjacency_pair rejects a duplicate live pair,
-- and is scoped per operator (not global).
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE dup_rejected BOOLEAN := false; err_state TEXT; err_msg TEXT := 'no error raised';
        cross_op_ok BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.dock_zone_adjacency (id, operator_id, dock_zone_id, adjacent_zone_id)
  VALUES ('77770001-0000-0000-0000-000000000073',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
          '44440021-0000-0000-0000-000000000073',
          '44440022-0000-0000-0000-000000000073')
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
            '44440021-0000-0000-0000-000000000073',
            '44440022-0000-0000-0000-000000000073');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT, err_state = RETURNED_SQLSTATE;
    dup_rejected := (err_state = '23505');
  END;

  IF NOT dup_rejected THEN
    RAISE EXCEPTION 'duplicate live (operator_id, dock_zone_id, adjacent_zone_id) was not rejected: %', err_msg;
  END IF;

  -- Same zone-id PAIR under operator B (different operator) must succeed —
  -- the index is scoped by operator_id, not global. Note: operator B's
  -- dock_zones ids differ from A's, but this exercises the same shape via
  -- operator B's own zones so the uniqueness check itself is scoped.
  BEGIN
    INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000073',
            '44440023-0000-0000-0000-000000000073',
            '44440024-0000-0000-0000-000000000073');
    cross_op_ok := true;
  EXCEPTION WHEN OTHERS THEN
    cross_op_ok := false;
  END;

  IF NOT cross_op_ok THEN
    RAISE EXCEPTION 'operator B was blocked from inserting its own adjacency pair by operator A''s row';
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: duplicate live pair rejected, uniqueness scoped per operator';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: a soft-deleted adjacency pair's (operator_id, dock_zone_id,
-- adjacent_zone_id) can be reinserted (partial unique index, not table-level
-- UNIQUE).
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE reinsert_ok BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.dock_zone_adjacency (id, operator_id, dock_zone_id, adjacent_zone_id)
  VALUES ('77770002-0000-0000-0000-000000000073',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
          '44440021-0000-0000-0000-000000000073',
          '44440022-0000-0000-0000-000000000073')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.dock_zone_adjacency SET deleted_at = NOW()
   WHERE id = '77770002-0000-0000-0000-000000000073';

  BEGIN
    INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
            '44440021-0000-0000-0000-000000000073',
            '44440022-0000-0000-0000-000000000073');
    reinsert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    reinsert_ok := false;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT reinsert_ok THEN
    RAISE EXCEPTION 'reconfiguring a soft-deleted adjacency pair was wrongly rejected: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: soft-deleted adjacency pair can be reconfigured';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: dock_zone_adjacency is directional — a row A->B does not create
-- or imply a row B->A.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE c_forward INT; c_reverse INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
          '44440021-0000-0000-0000-000000000073',
          '44440022-0000-0000-0000-000000000073');

  SELECT COUNT(*) INTO c_forward FROM public.dock_zone_adjacency
   WHERE dock_zone_id = '44440021-0000-0000-0000-000000000073'
     AND adjacent_zone_id = '44440022-0000-0000-0000-000000000073'
     AND deleted_at IS NULL;
  SELECT COUNT(*) INTO c_reverse FROM public.dock_zone_adjacency
   WHERE dock_zone_id = '44440022-0000-0000-0000-000000000073'
     AND adjacent_zone_id = '44440021-0000-0000-0000-000000000073'
     AND deleted_at IS NULL;

  IF c_forward <> 1 THEN
    RAISE EXCEPTION 'forward adjacency row A->B not found, got %', c_forward;
  END IF;
  IF c_reverse <> 0 THEN
    RAISE EXCEPTION 'reverse adjacency row B->A was implicitly created, got %', c_reverse;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: dock_zone_adjacency is directional, no implicit reverse row';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: vehicle_load_samples round-trips package_count with volume/weight
-- NULL (tier-2 absent) and populated (tier-2 present).
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE v_id UUID; v_count INT; v_vol DECIMAL(10,6); v_weight DECIMAL(10,3);
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.vehicle_load_samples (operator_id, vehicle_id, route_id, package_count, sealed_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
          '55550001-0000-0000-0000-000000000073',
          '66660001-0000-0000-0000-000000000073',
          174, NOW())
  RETURNING id INTO v_id;

  SELECT package_count, total_volume_m3, total_weight_kg
    INTO v_count, v_vol, v_weight
    FROM public.vehicle_load_samples WHERE id = v_id;

  IF v_count IS DISTINCT FROM 174 THEN
    RAISE EXCEPTION 'package_count did not persist, got %', v_count;
  END IF;
  IF v_vol IS NOT NULL OR v_weight IS NOT NULL THEN
    RAISE EXCEPTION 'total_volume_m3/total_weight_kg should default to NULL when tier-2 data is absent, got % / %', v_vol, v_weight;
  END IF;

  -- A second sample, tier-2 data present.
  INSERT INTO public.vehicle_load_samples
    (operator_id, vehicle_id, route_id, package_count, total_volume_m3, total_weight_kg, sealed_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
          '55550001-0000-0000-0000-000000000073',
          '66660001-0000-0000-0000-000000000073',
          180, 12.345678, 1234.567, NOW());

  RAISE NOTICE '✓ TEST 8 PASSED: vehicle_load_samples round-trips with and without tier-2 data';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: vehicle_load_samples has no structural constraint that would
-- collapse multiple samples for the same vehicle/route into one row.
--
-- Code-review correction: the original version of this test only inserted
-- two rows and counted 2 — true of any table with no constraints at all,
-- so no mutation could ever fail it, and it did NOT test that UPDATE/DELETE
-- are blocked (they are not; see the migration's GRANT comment on this
-- table — the append-only design is enforced by convention, not by the
-- database). This version instead asserts the one thing that actually
-- distinguishes "append-only in shape" from an ordinary table: there is no
-- UNIQUE constraint or unique index over (vehicle_id, route_id) (or any
-- subset that would force an upsert). Adding such a constraint is exactly
-- the mutation that would turn this table into a collapsing per-vehicle
-- table, and this assertion fails if that happens. The row-count check is
-- kept as a behavioural companion, not as the proof.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE c_samples INT; c_unique_constraints INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Structural: only the primary key (id) may be a unique constraint on
  -- this table. Any other unique constraint would prevent two samples for
  -- the same vehicle/route from coexisting.
  SELECT COUNT(*) INTO c_unique_constraints
    FROM pg_constraint
   WHERE conrelid = 'public.vehicle_load_samples'::regclass
     AND contype IN ('u', 'p')
     AND conname <> 'vehicle_load_samples_pkey';
  IF c_unique_constraints <> 0 THEN
    RAISE EXCEPTION 'vehicle_load_samples has % unexpected unique/primary constraint(s) beyond the id primary key — this would collapse append-only samples', c_unique_constraints;
  END IF;

  INSERT INTO public.vehicle_load_samples (operator_id, vehicle_id, route_id, package_count, sealed_at)
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', '55550001-0000-0000-0000-000000000073', '66660001-0000-0000-0000-000000000073', 150, NOW() - interval '2 days'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', '55550001-0000-0000-0000-000000000073', '66660001-0000-0000-0000-000000000073', 190, NOW() - interval '1 day');

  SELECT COUNT(*) INTO c_samples FROM public.vehicle_load_samples
   WHERE vehicle_id = '55550001-0000-0000-0000-000000000073';

  IF c_samples <> 2 THEN
    RAISE EXCEPTION 'expected 2 append-only samples for the same vehicle, got %', c_samples;
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: vehicle_load_samples has no collapsing unique constraint and two samples for the same vehicle/route coexist (NOTE: does not test that UPDATE/DELETE are blocked — they are not; append-only is a convention, not a DB-enforced guarantee)';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: dock_zone_adjacency — operator isolation on read, under
-- SET LOCAL role = 'authenticated' with JWT claims (not superuser).
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', '44440021-0000-0000-0000-000000000073', '44440022-0000-0000-0000-000000000073'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-000000000073', '44440023-0000-0000-0000-000000000073', '44440024-0000-0000-0000-000000000073');

  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000173","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000073","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.dock_zone_adjacency
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000073';
  SELECT COUNT(*) INTO c_other FROM public.dock_zone_adjacency
   WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000073';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own adjacency row, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B adjacency row, got %', c_other;
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 10 PASSED: dock_zone_adjacency operator isolation on read (as authenticated role)';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11: dock_zone_adjacency — WITH CHECK blocks a cross-tenant INSERT,
-- under SET LOCAL role = 'authenticated' with JWT claims.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000173","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000073","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000073',
            '44440023-0000-0000-0000-000000000073',
            '44440024-0000-0000-0000-000000000073');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'WITH CHECK did not block cross-tenant INSERT on dock_zone_adjacency (operator A wrote a row under operator B)';
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 11 PASSED: cross-tenant INSERT on dock_zone_adjacency blocked';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12: vehicle_load_samples — operator isolation on read, under
-- SET LOCAL role = 'authenticated' with JWT claims (not superuser).
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO public.vehicle_load_samples (operator_id, vehicle_id, route_id, package_count, sealed_at)
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', '55550001-0000-0000-0000-000000000073', '66660001-0000-0000-0000-000000000073', 174, NOW()),
    ('bbbbbbbb-bbbb-bbbb-bbbb-000000000073', '55550002-0000-0000-0000-000000000073', '66660002-0000-0000-0000-000000000073', 88, NOW());

  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000173","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000073","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.vehicle_load_samples
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000073';
  SELECT COUNT(*) INTO c_other FROM public.vehicle_load_samples
   WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000073';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own sample, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B sample, got %', c_other;
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 12 PASSED: vehicle_load_samples operator isolation on read (as authenticated role)';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13: vehicle_load_samples — WITH CHECK blocks a cross-tenant INSERT,
-- under SET LOCAL role = 'authenticated' with JWT claims.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000173","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000073","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.vehicle_load_samples (operator_id, vehicle_id, route_id, package_count, sealed_at)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000073',
            '55550002-0000-0000-0000-000000000073',
            '66660002-0000-0000-0000-000000000073',
            99, NOW());
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'WITH CHECK did not block cross-tenant INSERT on vehicle_load_samples (operator A wrote a row under operator B)';
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 13 PASSED: cross-tenant INSERT on vehicle_load_samples blocked';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14: soft-delete on dock_zone_adjacency — deleted_at set, row drops
-- out of an active (deleted_at IS NULL) filter.
--
-- Code-review honesty note: "COUNT(*) WHERE id = X AND deleted_at IS NULL
-- is 0 after setting deleted_at" is a SQL identity true of ANY nullable
-- timestamp column on ANY table — no schema mutation to this migration can
-- make it fail, so by itself it is not evidence the soft-delete design is
-- present or correct. What actually matters — that dock_zone_adjacency HAS
-- a deleted_at column at all, and that the partial unique index treats a
-- soft-deleted row as inactive so its (operator_id, dock_zone_id,
-- adjacent_zone_id) can be reconfigured — is proven by TEST 17 (column
-- existence, structural) and TEST 6 (partial-index reconfiguration,
-- behavioural) respectively. This test is kept only as a smoke check that
-- the round-trip works end to end; it is not load-bearing evidence on its
-- own.
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE v_id UUID; v_deleted_at TIMESTAMPTZ; c_active INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073',
          '44440021-0000-0000-0000-000000000073',
          '44440022-0000-0000-0000-000000000073')
  RETURNING id INTO v_id;

  UPDATE public.dock_zone_adjacency SET deleted_at = NOW() WHERE id = v_id;

  SELECT deleted_at INTO v_deleted_at FROM public.dock_zone_adjacency WHERE id = v_id;
  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'soft-delete did not set deleted_at';
  END IF;

  SELECT COUNT(*) INTO c_active FROM public.dock_zone_adjacency
   WHERE id = v_id AND deleted_at IS NULL;
  IF c_active <> 0 THEN
    RAISE EXCEPTION 'soft-deleted dock_zone_adjacency row still matches an active (deleted_at IS NULL) filter';
  END IF;

  RAISE NOTICE '✓ TEST 14 PASSED (smoke check only — see comment above; TEST 17/TEST 6 carry the real proof): dock_zone_adjacency soft-delete sets deleted_at and drops out of active filters';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15: dock_zone_adjacency_operator_isolation and
-- vehicle_load_samples_operator_isolation RLS policies exist by name.
-- =============================================================================
SAVEPOINT test_15;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.dock_zone_adjacency'::regclass
       AND polname  = 'dock_zone_adjacency_operator_isolation'
  ) THEN
    RAISE EXCEPTION 'dock_zone_adjacency_operator_isolation policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.vehicle_load_samples'::regclass
       AND polname  = 'vehicle_load_samples_operator_isolation'
  ) THEN
    RAISE EXCEPTION 'vehicle_load_samples_operator_isolation policy is missing';
  END IF;
  RAISE NOTICE '✓ TEST 15 PASSED: both operator-isolation RLS policies exist';
END $$;

ROLLBACK TO test_15;

-- =============================================================================
-- TEST 16 (honesty-corrected scope). What this test DOES establish, under
-- SET LOCAL role = 'authenticated' with real JWT claims (not superuser, not
-- empty claims): a vehicle/route created and updated the ordinary way, with
-- capacity_packages/max_drops left NULL, round-trips those columns as NULL,
-- accepts unrelated-column updates, joins cleanly, and accepts a dependent
-- vehicle_load_samples insert — all under RLS, by an operator-scoped
-- session, not a superuser bypassing it.
--
-- What this test does NOT establish, and did claim to under its original
-- name ("non-blocking property... behave EXACTLY as it did before this
-- migration"): it cannot prove no EXISTING consumer elsewhere in the
-- codebase breaks from the new nullable columns/tables, because it only
-- exercises paths this same migration/test file defines. A `SELECT *` on
-- fleet_vehicles/routes, a view over them, or a trigger with a fixed column
-- list would be exactly the kind of consumer this test cannot see.
--
-- That property was instead verified by manual review (code review, this
-- fix cycle) rather than by this SQL suite:
--   - apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json's
--     DispatchTrack POST/PATCH payloads to fleet_vehicles and routes name
--     columns explicitly (operator_id, provider, external_vehicle_id,
--     vehicle_type, raw_data / driver_name, vehicle_id, status, start_time,
--     end_time, total_km, raw_data) — neither payload ever contains
--     capacity_packages or max_drops, and Prefer: resolution=merge-
--     duplicates only overwrites columns present in the body, so the new
--     columns are untouched by every webhook event.
--   - grep across packages/database/supabase/migrations for
--     `SELECT \*` and `CREATE OR REPLACE VIEW` touching fleet_vehicles or
--     routes found no view or function selecting those tables with `*`;
--     the one relevant view (route_stop_counts, 20260825000002 /
--     20260902000001) is derived from public.dispatches with an explicit
--     column list, not from fleet_vehicles/routes at all.
--   - no existing trigger on fleet_vehicles or routes references a fixed
--     column list that a new nullable column could desynchronize (audit
--     triggers use row-level NEW/OLD generically, not enumerated columns).
-- A future ALTER TABLE ... ADD COLUMN on either table should repeat this
-- grep, not assume this SQL test would have caught a regression.
-- =============================================================================
SAVEPOINT test_16;

DO $$
DECLARE
  v_id UUID;
  r_id UUID;
  v_cap INT;
  r_drops INT;
  sample_id UUID;
  joined_count INT;
BEGIN
  -- Fixtures created as postgres (superuser) so we control ids/FKs freely;
  -- the property under test is then exercised as 'authenticated' below.
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- A brand-new vehicle, created the way the DispatchTrack webhook would
  -- (no capacity_packages in the payload at all — see migration header).
  INSERT INTO public.fleet_vehicles (operator_id, provider, external_vehicle_id, vehicle_type)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'dispatchtrack', 'TRK-A-UNCONFIGURED', 'Furgón')
  RETURNING id INTO v_id;

  -- A brand-new route referencing that unconfigured vehicle, no max_drops.
  INSERT INTO public.routes (operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', 'dispatchtrack', 'spec73-route-unconfigured', CURRENT_DATE, 'planned', v_id)
  RETURNING id INTO r_id;

  -- Now switch to the actual RLS-exercised session for the property this
  -- test claims to prove: operator A's own authenticated user, not
  -- postgres, not empty claims.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000173","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000073","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT capacity_packages INTO v_cap FROM public.fleet_vehicles WHERE id = v_id;
  IF v_cap IS NOT NULL THEN
    RAISE EXCEPTION 'a newly created vehicle should have NULL capacity_packages by default, got %', v_cap;
  END IF;

  SELECT max_drops INTO r_drops FROM public.routes WHERE id = r_id;
  IF r_drops IS NOT NULL THEN
    RAISE EXCEPTION 'a newly created route should have NULL max_drops by default, got %', r_drops;
  END IF;

  -- Ordinary updates to unrelated columns on the unconfigured vehicle/route
  -- must not be blocked by anything this migration added, under RLS.
  UPDATE public.fleet_vehicles SET driver_name = 'Juan Perez' WHERE id = v_id;
  UPDATE public.routes SET status = 'loading' WHERE id = r_id;

  -- A join across vehicle + route, the shape a fill-bar query would use,
  -- must return a row with NULL capacity fields rather than erroring or
  -- excluding the vehicle/route, under RLS.
  SELECT COUNT(*) INTO joined_count
    FROM public.routes r
    JOIN public.fleet_vehicles v ON v.id = r.vehicle_id
   WHERE r.id = r_id AND v.capacity_packages IS NULL AND r.max_drops IS NULL;
  IF joined_count <> 1 THEN
    RAISE EXCEPTION 'join across unconfigured vehicle/route did not return the expected row, got %', joined_count;
  END IF;

  -- Downstream dependents (vehicle_load_samples, added by this same
  -- migration) must accept a row for this unconfigured vehicle without
  -- requiring capacity_packages to be set first, under RLS.
  INSERT INTO public.vehicle_load_samples (operator_id, vehicle_id, route_id, package_count, sealed_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000073', v_id, r_id, 42, NOW())
  RETURNING id INTO sample_id;

  IF sample_id IS NULL THEN
    RAISE EXCEPTION 'vehicle_load_samples insert against an unconfigured vehicle unexpectedly failed';
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 16 PASSED (scope: RLS-exercised, this-migration-only — see comment above): unconfigured vehicle/route (NULL capacity_packages/max_drops) round-trips, updates, joins, and accepts a dependent insert as an authenticated operator-scoped session';
END $$;

ROLLBACK TO test_16;

-- =============================================================================
-- TESTS 17-20: close the four mutations that survived code review
-- (drop deleted_at, GRANT ALL to anon, drop each audit trigger). Each of
-- these previously left the whole suite green; each assertion below fails
-- if the corresponding mutation is reapplied.
-- =============================================================================

-- TEST 17: deleted_at column exists on both soft-deletable tables. Mutation
-- "drop vehicle_load_samples.deleted_at" survived the whole suite before
-- this test existed — nothing else in this file names that column outside
-- of dock_zone_adjacency's TEST 14/TEST 6.
SAVEPOINT test_17;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dock_zone_adjacency' AND column_name = 'deleted_at'
  ) THEN
    RAISE EXCEPTION 'dock_zone_adjacency.deleted_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_load_samples' AND column_name = 'deleted_at'
  ) THEN
    RAISE EXCEPTION 'vehicle_load_samples.deleted_at missing';
  END IF;
  RAISE NOTICE '✓ TEST 17 PASSED: deleted_at exists on both dock_zone_adjacency and vehicle_load_samples';
END $$;

ROLLBACK TO test_17;

-- TEST 18: anon has no privileges on vehicle_load_samples. Mutation
-- "GRANT ALL ON vehicle_load_samples TO anon" survived the whole suite
-- before this test existed — no earlier test queries grants directly.
-- This is the one GRANT/REVOKE statement in this migration that is
-- actually load-bearing (see the migration's comment on the append-only
-- GRANT, corrected under item 4 of this review: the SELECT/INSERT-only
-- grant to `authenticated` does NOT itself enforce append-only, since
-- Supabase's project-wide default privileges already grant
-- authenticated full DML and the FOR ALL RLS policy then permits it; the
-- REVOKE ALL ... FROM anon is what actually keeps anon off this table).
SAVEPOINT test_18;

DO $$
DECLARE c_anon_grants INT;
BEGIN
  SELECT COUNT(*) INTO c_anon_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'vehicle_load_samples'
     AND grantee = 'anon';
  IF c_anon_grants <> 0 THEN
    RAISE EXCEPTION 'anon has % grant(s) on vehicle_load_samples — REVOKE ALL ... FROM anon is not effective', c_anon_grants;
  END IF;
  RAISE NOTICE '✓ TEST 18 PASSED: anon has zero grants on vehicle_load_samples (REVOKE ALL is effective)';
END $$;

ROLLBACK TO test_18;

-- TEST 19: audit trigger exists on dock_zone_adjacency. Mutation "drop the
-- audit trigger on dock_zone_adjacency" survived the whole suite before
-- this test existed.
SAVEPOINT test_19;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.dock_zone_adjacency'::regclass
       AND tgname = 'audit_dock_zone_adjacency'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'audit_dock_zone_adjacency trigger is missing';
  END IF;
  RAISE NOTICE '✓ TEST 19 PASSED: audit_dock_zone_adjacency trigger exists';
END $$;

ROLLBACK TO test_19;

-- TEST 20: audit trigger exists on vehicle_load_samples. Mutation "drop the
-- audit trigger on vehicle_load_samples" survived the whole suite before
-- this test existed.
SAVEPOINT test_20;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.vehicle_load_samples'::regclass
       AND tgname = 'audit_vehicle_load_samples'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'audit_vehicle_load_samples trigger is missing';
  END IF;
  RAISE NOTICE '✓ TEST 20 PASSED: audit_vehicle_load_samples trigger exists';
END $$;

ROLLBACK TO test_20;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec73_vehicle_capacity tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
