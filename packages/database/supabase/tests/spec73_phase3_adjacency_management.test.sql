-- =============================================================================
-- spec-73 phase 3 — adjacency management RPCs: add_dock_zone_adjacency_pair,
-- remove_dock_zone_adjacency_pair.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec73_phase3_adjacency_management.test.sql
--
-- Fixture note (mirrors spec66_ops_leader_route_authz.sql): rows are
-- inserted directly into public.users with an explicit `role`, and the
-- caller's identity for each test is set via
-- `SET LOCAL request.jwt.claims` + `SET LOCAL ROLE authenticated;` because
-- both RPCs read role from public.users (not the JWT claim) and operator_id
-- via public.get_operator_id() (which itself reads auth.uid(), i.e. the
-- 'sub' claim). SAVEPOINT/ROLLBACK TO per test, matching
-- spec73_vehicle_capacity.test.sql's house style.
-- =============================================================================

BEGIN;

-- ── FIXTURE ────────────────────────────────────────────────────────────────

INSERT INTO public.operators (id, name, slug, country_code) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730003', 'Spec73 P3 Operator A', 'spec73-p3-op-a', 'CL'),
  ('bbbbbbbb-0000-4000-a000-000000730003', 'Spec73 P3 Operator B', 'spec73-p3-op-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730011','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec73p3-opsleader@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003","role":"ops_leader"}'::jsonb,
   '{"full_name":"Jefa Piso"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000730012','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec73p3-warehouse@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003","role":"warehouse_staff"}'::jsonb,
   '{"full_name":"Bodega"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-a000-000000730013','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec73p3-admin-b@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-a000-000000730003","role":"admin"}'::jsonb,
   '{"full_name":"Admin B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, role, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730011','aaaaaaaa-0000-4000-a000-000000730003',
   'spec73p3-opsleader@test.test','Jefa Piso','ops_leader',
   ARRAY['pickup','reception','distribution','dispatch']),
  ('aaaaaaaa-0000-4000-a000-000000730012','aaaaaaaa-0000-4000-a000-000000730003',
   'spec73p3-warehouse@test.test','Bodega','warehouse_staff',
   ARRAY['reception','distribution']),
  ('bbbbbbbb-0000-4000-a000-000000730013','bbbbbbbb-0000-4000-a000-000000730003',
   'spec73p3-admin-b@test.test','Admin B','admin',
   ARRAY['pickup','reception','distribution','dispatch','customer_service','admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      role        = EXCLUDED.role,
      permissions = EXCLUDED.permissions;

-- Three andenes for operator A (self-pair / normal-pair / third-zone cases),
-- one for operator B (cross-tenant isolation case).
INSERT INTO public.dock_zones (id, operator_id, name, code, is_active) VALUES
  ('44440031-0000-0000-0000-000000730003', 'aaaaaaaa-0000-4000-a000-000000730003', 'Andén P3-A1', 'P3-A1', true),
  ('44440032-0000-0000-0000-000000730003', 'aaaaaaaa-0000-4000-a000-000000730003', 'Andén P3-A2', 'P3-A2', true),
  ('44440033-0000-0000-0000-000000730003', 'aaaaaaaa-0000-4000-a000-000000730003', 'Andén P3-A3', 'P3-A3', true),
  ('44440034-0000-0000-0000-000000730003', 'bbbbbbbb-0000-4000-a000-000000730003', 'Andén P3-B1', 'P3-B1', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: add_dock_zone_adjacency_pair, called by an ops_leader, writes BOTH
-- directions as live rows in one call (the "symmetric at write time" decision).
-- =============================================================================
SAVEPOINT test_1;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_forward INT; c_reverse INT;
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );

  SELECT COUNT(*) INTO c_forward FROM public.dock_zone_adjacency
   WHERE dock_zone_id = '44440031-0000-0000-0000-000000730003'
     AND adjacent_zone_id = '44440032-0000-0000-0000-000000730003'
     AND deleted_at IS NULL;
  SELECT COUNT(*) INTO c_reverse FROM public.dock_zone_adjacency
   WHERE dock_zone_id = '44440032-0000-0000-0000-000000730003'
     AND adjacent_zone_id = '44440031-0000-0000-0000-000000730003'
     AND deleted_at IS NULL;

  IF c_forward <> 1 THEN
    RAISE EXCEPTION 'forward row A->B not written, got %', c_forward;
  END IF;
  IF c_reverse <> 1 THEN
    RAISE EXCEPTION 'reverse row B->A not written by add_dock_zone_adjacency_pair, got %', c_reverse;
  END IF;
  RAISE NOTICE '✓ TEST 1 PASSED: add_dock_zone_adjacency_pair writes both directions';
END $$;
RESET ROLE;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: remove_dock_zone_adjacency_pair, called by an ops_leader,
-- soft-deletes BOTH directions in one call.
-- =============================================================================
SAVEPOINT test_2;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_removed INT; c_live INT;
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );

  v_removed := public.remove_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );

  IF v_removed <> 2 THEN
    RAISE EXCEPTION 'remove_dock_zone_adjacency_pair reported % rows removed, expected 2', v_removed;
  END IF;

  SELECT COUNT(*) INTO c_live FROM public.dock_zone_adjacency
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000730003'
     AND ((dock_zone_id = '44440031-0000-0000-0000-000000730003' AND adjacent_zone_id = '44440032-0000-0000-0000-000000730003')
       OR (dock_zone_id = '44440032-0000-0000-0000-000000730003' AND adjacent_zone_id = '44440031-0000-0000-0000-000000730003'))
     AND deleted_at IS NULL;

  IF c_live <> 0 THEN
    RAISE EXCEPTION 'a live row remains after remove_dock_zone_adjacency_pair, got %', c_live;
  END IF;
  RAISE NOTICE '✓ TEST 2 PASSED: remove_dock_zone_adjacency_pair soft-deletes both directions';
END $$;
RESET ROLE;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: role gate on add — warehouse_staff is refused (42501).
-- =============================================================================
SAVEPOINT test_3;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730012","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );
  RAISE EXCEPTION 'warehouse_staff was allowed to add an adjacency pair — the role gate is not enforced';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '✓ TEST 3 PASSED: warehouse_staff refused (42501) on add_dock_zone_adjacency_pair';
END $$;
RESET ROLE;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: role gate on remove — warehouse_staff is refused (42501).
-- =============================================================================
SAVEPOINT test_4;

-- Seed as ops_leader first, so there is something to (attempt to) remove.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );
END $$;
RESET ROLE;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730012","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.remove_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );
  RAISE EXCEPTION 'warehouse_staff was allowed to remove an adjacency pair — the role gate is not enforced';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '✓ TEST 4 PASSED: warehouse_staff refused (42501) on remove_dock_zone_adjacency_pair';
END $$;
RESET ROLE;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: the RPC rejects a self-pair (22023) for an authorised caller,
-- independent of the not-self CHECK constraint (phase 1 TEST 4 already
-- covers the constraint directly; this proves the RPC's own guard fires
-- first with the friendly message rather than falling through to a raw
-- constraint-violation error).
-- =============================================================================
SAVEPOINT test_5;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440031-0000-0000-0000-000000730003'::uuid
  );
  RAISE EXCEPTION 'add_dock_zone_adjacency_pair accepted a zone paired with itself';
EXCEPTION
  WHEN sqlstate '22023' THEN
    RAISE NOTICE '✓ TEST 5 PASSED: self-pair refused (22023) by the RPC''s own guard';
END $$;
RESET ROLE;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: operator isolation — an authorised caller of operator A cannot
-- add a pair naming operator B's zone; the RPC refuses with 'Andén
-- adyacente no encontrado' rather than writing a cross-tenant row.
-- =============================================================================
SAVEPOINT test_6;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_leak INT;
BEGIN
  BEGIN
    PERFORM public.add_dock_zone_adjacency_pair(
      '44440031-0000-0000-0000-000000730003'::uuid,   -- operator A's zone
      '44440034-0000-0000-0000-000000730003'::uuid    -- operator B's zone
    );
    RAISE EXCEPTION 'add_dock_zone_adjacency_pair accepted a cross-tenant zone pair';
  EXCEPTION
    WHEN sqlstate '22023' THEN
      NULL; -- expected: 'Andén adyacente no encontrado'
  END;

  SELECT COUNT(*) INTO c_leak FROM public.dock_zone_adjacency
   WHERE '44440034-0000-0000-0000-000000730003' IN (dock_zone_id, adjacent_zone_id);
  IF c_leak <> 0 THEN
    RAISE EXCEPTION 'a cross-tenant adjacency row was written despite the refusal, got %', c_leak;
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: cross-tenant zone pair refused, no row leaked';
END $$;
RESET ROLE;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: re-adding a previously soft-deleted pair INSERTS A NEW ROW rather
-- than resurrecting the old one (this migration's documented decision).
-- =============================================================================
SAVEPOINT test_7;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_first_id UUID; v_second_id UUID; c_soft_deleted INT;
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );
  SELECT id INTO v_first_id FROM public.dock_zone_adjacency
   WHERE dock_zone_id = '44440031-0000-0000-0000-000000730003'
     AND adjacent_zone_id = '44440032-0000-0000-0000-000000730003'
     AND deleted_at IS NULL;

  PERFORM public.remove_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );

  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );
  SELECT id INTO v_second_id FROM public.dock_zone_adjacency
   WHERE dock_zone_id = '44440031-0000-0000-0000-000000730003'
     AND adjacent_zone_id = '44440032-0000-0000-0000-000000730003'
     AND deleted_at IS NULL;

  IF v_second_id = v_first_id THEN
    RAISE EXCEPTION 're-add reused the original row id — expected a new INSERT, not a resurrect';
  END IF;

  -- The original row must still exist, soft-deleted (never a hard DELETE).
  SELECT COUNT(*) INTO c_soft_deleted FROM public.dock_zone_adjacency
   WHERE id = v_first_id AND deleted_at IS NOT NULL;
  IF c_soft_deleted <> 1 THEN
    RAISE EXCEPTION 'original soft-deleted row (id %) is missing after re-add', v_first_id;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: re-add inserts a new row; the soft-deleted original is preserved';
END $$;
RESET ROLE;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: add is idempotent — calling it twice on an already-live pair does
-- not error and does not create duplicate live rows (ON CONFLICT ... DO
-- NOTHING).
-- =============================================================================
SAVEPOINT test_8;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_live INT;
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440033-0000-0000-0000-000000730003'::uuid
  );
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440033-0000-0000-0000-000000730003'::uuid
  );

  SELECT COUNT(*) INTO c_live FROM public.dock_zone_adjacency
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000730003'
     AND ((dock_zone_id = '44440031-0000-0000-0000-000000730003' AND adjacent_zone_id = '44440033-0000-0000-0000-000000730003')
       OR (dock_zone_id = '44440033-0000-0000-0000-000000730003' AND adjacent_zone_id = '44440031-0000-0000-0000-000000730003'))
     AND deleted_at IS NULL;

  IF c_live <> 2 THEN
    RAISE EXCEPTION 'calling add twice produced % live rows, expected exactly 2 (idempotent)', c_live;
  END IF;
  RAISE NOTICE '✓ TEST 8 PASSED: add_dock_zone_adjacency_pair is idempotent on an already-live pair';
END $$;
RESET ROLE;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: a symmetric-read query (WHERE dock_zone_id = X OR adjacent_zone_id
-- = X, per phase 4's documented read shape) finds the pair from EITHER
-- zone's side after add_dock_zone_adjacency_pair — proving the write path
-- and the documented read path agree, closing the phase-4 "direction
-- hazard" this migration exists to resolve.
-- =============================================================================
SAVEPOINT test_9;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_from_a INT; c_from_b INT;
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid
  );

  SELECT COUNT(*) INTO c_from_a FROM public.dock_zone_adjacency
   WHERE (dock_zone_id = '44440031-0000-0000-0000-000000730003'
          OR adjacent_zone_id = '44440031-0000-0000-0000-000000730003')
     AND deleted_at IS NULL;
  SELECT COUNT(*) INTO c_from_b FROM public.dock_zone_adjacency
   WHERE (dock_zone_id = '44440032-0000-0000-0000-000000730003'
          OR adjacent_zone_id = '44440032-0000-0000-0000-000000730003')
     AND deleted_at IS NULL;

  -- Each side sees exactly 2 rows for this one pair (its own outbound row
  -- plus the other zone's outbound row naming it back) -- proof the
  -- symmetric read finds the neighbour from either zone.
  IF c_from_a <> 2 THEN
    RAISE EXCEPTION 'symmetric read from zone A found % rows, expected 2', c_from_a;
  END IF;
  IF c_from_b <> 2 THEN
    RAISE EXCEPTION 'symmetric read from zone B found % rows, expected 2', c_from_b;
  END IF;
  RAISE NOTICE '✓ TEST 9 PASSED: symmetric OR-read finds the pair from either zone';
END $$;
RESET ROLE;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 (review): the RPCs are the ONLY write path. `authenticated` must
-- have no direct INSERT/UPDATE/DELETE on dock_zone_adjacency, otherwise the
-- role gate inside the RPCs is decoration: phase 1's grant + tenant-only RLS
-- let ANY authenticated user of the operator POST straight to
-- /rest/v1/dock_zone_adjacency (and hard-DELETE every row, defeating the
-- soft-delete rule too). Proven RED against the pre-REVOKE migration.
-- =============================================================================
SAVEPOINT test_10;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated can INSERT dock_zone_adjacency directly - the RPC role gate is bypassable';
  END IF;
  IF has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can UPDATE dock_zone_adjacency directly - the RPC role gate is bypassable';
  END IF;
  IF has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated can hard-DELETE dock_zone_adjacency directly - soft-delete-only is bypassable';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.dock_zone_adjacency', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT - useDockZoneAdjacencyPairs reads this table directly';
  END IF;
END $$;

-- And the live proof, not just the catalogue: a warehouse_staff session
-- attempting the exact write the RPC refuses is stopped by the engine.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730012","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  VALUES ('aaaaaaaa-0000-4000-a000-000000730003',
          '44440031-0000-0000-0000-000000730003',
          '44440032-0000-0000-0000-000000730003');
  RAISE EXCEPTION 'warehouse_staff wrote dock_zone_adjacency directly, bypassing add_dock_zone_adjacency_pair';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK TEST 10 PASSED: no direct write path to dock_zone_adjacency for authenticated';
END $$;
RESET ROLE;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11 (review): add writes its two rows in CANONICAL (LEAST, GREATEST)
-- order regardless of the caller's argument order. Two managers adding the
-- same pair with swapped arguments at the same instant would otherwise take
-- the two speculative row locks in opposite orders and deadlock (40P01) -
-- the one hole in this migration's single-statement atomicity claim.
-- =============================================================================
SAVEPOINT test_11;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_first UUID; v_low UUID; v_high UUID;
BEGIN
  v_low  := LEAST('44440031-0000-0000-0000-000000730003'::uuid, '44440032-0000-0000-0000-000000730003'::uuid);
  v_high := GREATEST('44440031-0000-0000-0000-000000730003'::uuid, '44440032-0000-0000-0000-000000730003'::uuid);

  -- Called with the HIGH zone first - the returned rows must still start at
  -- the low one.
  SELECT dock_zone_id INTO v_first FROM public.add_dock_zone_adjacency_pair(v_high, v_low) LIMIT 1;
  IF v_first <> v_low THEN
    RAISE EXCEPTION 'add(high, low) inserted % first, not the canonical LEAST % - lock order follows the caller, deadlock is reachable', v_first, v_low;
  END IF;

  -- Both rows are still there, both live: canonical ordering must not have
  -- changed WHAT is written, only the order it is written in.
  IF (SELECT COUNT(*) FROM public.dock_zone_adjacency
       WHERE deleted_at IS NULL
         AND ((dock_zone_id = v_low AND adjacent_zone_id = v_high)
           OR (dock_zone_id = v_high AND adjacent_zone_id = v_low))) <> 2 THEN
    RAISE EXCEPTION 'canonical ordering changed which rows are written';
  END IF;
  RAISE NOTICE 'OK TEST 11 PASSED: add takes its row locks in canonical order for either argument order';
END $$;
RESET ROLE;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12 (review): the mixed legacy state - one direction LIVE, the other
-- SOFT-DELETED. add must self-heal it to a fully live symmetric pair without
-- resurrecting or duplicating anything, and a following remove must report 2.
-- =============================================================================
SAVEPOINT test_12;

INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id, deleted_at) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730003','44440031-0000-0000-0000-000000730003','44440032-0000-0000-0000-000000730003', NULL),
  ('aaaaaaaa-0000-4000-a000-000000730003','44440032-0000-0000-0000-000000730003','44440031-0000-0000-0000-000000730003', NOW());

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_live INT; c_dead INT; v_removed INT;
BEGIN
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid);

  SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL),
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)
    INTO c_live, c_dead
    FROM public.dock_zone_adjacency
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000730003';

  IF c_live <> 2 THEN
    RAISE EXCEPTION 'mixed live/soft-deleted state healed to % live rows, expected 2', c_live;
  END IF;
  IF c_dead <> 1 THEN
    RAISE EXCEPTION 'the pre-existing soft-deleted row was resurrected or lost (% remain)', c_dead;
  END IF;

  v_removed := public.remove_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid);
  IF v_removed <> 2 THEN
    RAISE EXCEPTION 'remove after self-heal reported %, expected 2', v_removed;
  END IF;
  RAISE NOTICE 'OK TEST 12 PASSED: mixed live/soft-deleted pair self-heals without resurrecting';
END $$;
RESET ROLE;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13 (review): the role read fails CLOSED. A JWT whose `sub` has no live
-- public.users row (deleted employee, or an auth.users row that never got its
-- profile) must be refused, never allowed through on a NULL role.
-- =============================================================================
SAVEPOINT test_13;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('cccccccc-0000-4000-a000-000000730099','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec73p3-ghost@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003","role":"admin"}'::jsonb,
   '{"full_name":"Fantasma"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;
-- The JWT claims an admin role; the profile row is gone.
DELETE FROM public.users WHERE id = 'cccccccc-0000-4000-a000-000000730099';

SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-a000-000000730099","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_written INT;
BEGIN
  BEGIN
    PERFORM public.add_dock_zone_adjacency_pair(
      '44440031-0000-0000-0000-000000730003'::uuid,
      '44440032-0000-0000-0000-000000730003'::uuid);
    RAISE EXCEPTION 'a JWT with no live public.users row was allowed to write - the gate fails OPEN';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- expected
  END;

  SELECT COUNT(*) INTO c_written FROM public.dock_zone_adjacency WHERE deleted_at IS NULL;
  IF c_written <> 0 THEN
    RAISE EXCEPTION 'rows were written despite the refusal, got %', c_written;
  END IF;
  RAISE NOTICE 'OK TEST 13 PASSED: a JWT with no live users row is refused (fails closed)';
END $$;
RESET ROLE;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14 (review): the asymmetric legacy state on REMOVE. If only one
-- direction is live (a row written before this phase existed), remove must
-- succeed and report 1 - not error, and not leave the survivor behind. A
-- second call reports 0 rather than failing, so the UI's fire-and-forget
-- remove is safe to retry.
-- =============================================================================
SAVEPOINT test_14;

INSERT INTO public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730003','44440031-0000-0000-0000-000000730003','44440032-0000-0000-0000-000000730003');

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_first INT; v_second INT; c_live INT;
BEGIN
  v_first := public.remove_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid);
  IF v_first <> 1 THEN
    RAISE EXCEPTION 'remove on a one-direction-only pair reported %, expected 1', v_first;
  END IF;

  SELECT COUNT(*) INTO c_live FROM public.dock_zone_adjacency WHERE deleted_at IS NULL;
  IF c_live <> 0 THEN
    RAISE EXCEPTION 'the asymmetric survivor is still live after remove, got %', c_live;
  END IF;

  v_second := public.remove_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid);
  IF v_second <> 0 THEN
    RAISE EXCEPTION 'a repeat remove reported %, expected 0', v_second;
  END IF;
  RAISE NOTICE 'OK TEST 14 PASSED: remove handles the one-direction-only pair and is safely repeatable';
END $$;
RESET ROLE;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15 (review): soft-deleting an anden takes its adjacency rows with it.
-- The FKs' ON DELETE CASCADE never fires (dock_zones is only soft-deleted),
-- so without the cascade trigger a retired anden keeps LIVE adjacency rows
-- pointing at it - which phase 4's candidate search would offer as a top-up
-- source. Proven RED before the trigger landed (2 live rows survived).
-- =============================================================================
SAVEPOINT test_15;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000730011","operator_id":"aaaaaaaa-0000-4000-a000-000000730003","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000730003"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE c_live INT; c_untouched INT;
BEGIN
  -- Two pairs: A1<->A2 (touches the zone about to be retired) and A1<->A3
  -- (does not touch it, and must survive).
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440032-0000-0000-0000-000000730003'::uuid);
  PERFORM public.add_dock_zone_adjacency_pair(
    '44440031-0000-0000-0000-000000730003'::uuid,
    '44440033-0000-0000-0000-000000730003'::uuid);

  -- Retire anden A2 exactly the way the UI does it (useDockZones.ts): a plain
  -- soft-delete UPDATE, performed by the `authenticated` role.
  UPDATE public.dock_zones
     SET deleted_at = NOW()
   WHERE id = '44440032-0000-0000-0000-000000730003';

  SELECT COUNT(*) INTO c_live FROM public.dock_zone_adjacency
   WHERE deleted_at IS NULL
     AND '44440032-0000-0000-0000-000000730003' IN (dock_zone_id, adjacent_zone_id);
  IF c_live <> 0 THEN
    RAISE EXCEPTION '% live adjacency rows still point at a soft-deleted anden - phase 4 would offer a dead zone as a top-up candidate', c_live;
  END IF;

  SELECT COUNT(*) INTO c_untouched FROM public.dock_zone_adjacency
   WHERE deleted_at IS NULL
     AND '44440033-0000-0000-0000-000000730003' IN (dock_zone_id, adjacent_zone_id);
  IF c_untouched <> 2 THEN
    RAISE EXCEPTION 'the cascade took unrelated pairs with it: % live rows for A1<->A3, expected 2', c_untouched;
  END IF;
  RAISE NOTICE 'OK TEST 15 PASSED: soft-deleting an anden soft-deletes only its own adjacency rows';
END $$;
RESET ROLE;

ROLLBACK TO test_15;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec73_phase3_adjacency_management tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
