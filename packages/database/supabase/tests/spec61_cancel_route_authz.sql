-- spec-61 Task 5 — cancel_pickup_route: who may cancel a pickup route.
--
-- Before migration 20260821000001 the function checked the caller's OPERATOR
-- and nothing else, with EXECUTE granted to `authenticated`: any user of an
-- operator could cancel any open route in it, including a pickup_crew member
-- cancelling their own leader's route mid-shift. This file is the proof that
-- the gate exists and that it lets exactly the right people through.
--
-- RUNS AS `authenticated` VIA `SET LOCAL ROLE`, not as the owner. Two reasons,
-- both learned the hard way on this spec:
--   * the owner is exempt from RLS and, more to the point here, EXECUTE on
--     this function is granted to `authenticated` specifically -- an owner
--     connection would prove nothing about the role that actually calls it;
--   * the refusals below must come from the function's own gate, not from a
--     privilege the test connection happens to lack.
-- The guard block after the fixture pins that assumption. Rows are read back
-- as the OWNER afterwards, deliberately: what is under test is who the
-- FUNCTION lets act, and a post-hoc read through RLS would conflate a refused
-- cancel with a row the reader merely cannot see.
--
-- TWO OPERATORS, deliberately. With one, `operator_id = v_operator` in the
-- route lookup is unfalsifiable -- every fixture row satisfies it whether the
-- clause is there or not. Operator B exists so a cross-tenant call has
-- something real to fail against, in BOTH directions: an ordinary leader from
-- B, and (the dangerous one) an ELEVATED user from A reaching for B's route.
--
-- THE FIXTURE, and why each row exists:
--   641 Lider Uno    leader + driver of route 1   -> may cancel route 1
--   642 Ana Perez    pickup_crew, seated on r1    -> refused (the whole point)
--   643 Lider Dos    leader + driver of route 2   -> refused on route 1:
--                    `pickup_leader` is NOT an elevated role here, and this
--                    row is the only thing that proves it
--   644 Jefa Ops     operations_manager, drives   -> may cancel route 2,
--                    nothing               which is somebody else's
--   B645 Otro Lider  operator B, drives route X   -> refused on route 1
BEGIN;

INSERT INTO public.operators (id, name, slug) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000640','Spec61 Cancel','spec61-cancel'),
  ('bbbbbbbb-0000-4000-b000-000000000640','Spec61 Cancel Other','spec61-cancel-other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000641','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cancel-leader1@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000642','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cancel-crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000643','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cancel-leader2@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Dos"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000644','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cancel-ops@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"operations_manager"}'::jsonb,
   '{"full_name":"Jefa Ops"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000645','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cancel-other-op@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000640","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Otro Lider"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000641','aaaaaaaa-0000-4000-a000-000000000640','pickup_leader','cancel-leader1@spec61.test','Lider Uno',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000642','aaaaaaaa-0000-4000-a000-000000000640','pickup_crew','cancel-crew@spec61.test','Ana Perez',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000643','aaaaaaaa-0000-4000-a000-000000000640','pickup_leader','cancel-leader2@spec61.test','Lider Dos',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000644','aaaaaaaa-0000-4000-a000-000000000640','operations_manager','cancel-ops@spec61.test','Jefa Ops',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000645','bbbbbbbb-0000-4000-b000-000000000640','pickup_leader','cancel-other-op@spec61.test','Otro Lider',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000641','aaaaaaaa-0000-4000-a000-000000000640','VEH-64-1', true),
  ('99999999-0000-4000-9000-000000000642','aaaaaaaa-0000-4000-a000-000000000640','VEH-64-2', true),
  ('99999999-0000-4000-9000-000000000645','bbbbbbbb-0000-4000-b000-000000000640','VEH-64-5', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, started_at) VALUES
  ('77777777-0000-4000-7000-000000000641','aaaaaaaa-0000-4000-a000-000000000640',
   'PR-61-C1','aaaaaaaa-0000-4000-a000-000000000641','99999999-0000-4000-9000-000000000641','in_progress', NOW() - INTERVAL '2 hours'),
  ('77777777-0000-4000-7000-000000000642','aaaaaaaa-0000-4000-a000-000000000640',
   'PR-61-C2','aaaaaaaa-0000-4000-a000-000000000643','99999999-0000-4000-9000-000000000642','in_progress', NOW() - INTERVAL '1 hour'),
  ('77777777-0000-4000-7000-000000000645','bbbbbbbb-0000-4000-b000-000000000640',
   'PR-61-CX','bbbbbbbb-0000-4000-b000-000000000645','99999999-0000-4000-9000-000000000645','in_progress', NOW());

-- Ana rides route 1. Her seat is what makes TEST 1 a crew refusal rather than
-- a stranger refusal: she is genuinely ON the route she is trying to kill.
INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by, removed_at) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000640','77777777-0000-4000-7000-000000000641',
   'aaaaaaaa-0000-4000-a000-000000000642','aaaaaaaa-0000-4000-a000-000000000641', NULL);

-- ─── GUARD: the connection role bypasses RLS, so SET ROLE is mandatory ─────
-- Template: rls_operators_test.sql:75-88, spec61_my_active_route.sql:136-151.
-- If a future edit drops the `SET LOCAL ROLE authenticated` lines below, every
-- call in this file runs as the owner and stops testing the grant at all.
-- Pin it: as the owner we must see BOTH operators.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE slug IN ('spec61-cancel','spec61-cancel-other');
  IF c <> 2 THEN
    RAISE EXCEPTION
      'owner context saw % of 2 fixture operators — this file assumes the connection role bypasses RLS and therefore MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ── TEST 1: a CREW member of the route cannot cancel it ────────────────────
-- The defect this migration exists for. Ana is on route 1 and, before the
-- gate, could end her own leader's shift and detach every manifest on it.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000642","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.cancel_pickup_route('77777777-0000-4000-7000-000000000641'::uuid, 'no');
    RAISE EXCEPTION 'a pickup_crew member must not be able to cancel the route they ride on';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  -- Reaches the driver verbatim (useCancelPickupRoute rethrows RPC messages),
  -- so it must be the Spanish sentence, not a Postgres string.
  IF msg NOT LIKE '%Solo el líder de esta ruta%' THEN
    RAISE EXCEPTION 'refusal message is not the Spanish one the UI shows: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 2: a DIFFERENT leader in the same operator cannot cancel it ───────
-- The single most important row in this file. `pickup_leader` is on
-- start_pickup_route's list ("who may OPEN a route") and is deliberately NOT
-- on this one ("who may cancel THIS route"). Delete that distinction — reuse
-- ROUTE_LEADER_ROLES here, say — and only this test notices.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000643","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.cancel_pickup_route('77777777-0000-4000-7000-000000000641'::uuid, 'no');
    RAISE EXCEPTION 'a pickup_leader who does not drive this route must not be able to cancel it';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE '%Solo el líder de esta ruta%' THEN
    RAISE EXCEPTION 'refusal message unexpected: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 3: a leader from ANOTHER operator cannot cancel it ────────────────
-- Refused by the route lookup's `operator_id = v_operator`, before the new
-- gate is even reached — hence the different (pre-existing, English) message.
-- Asserting the message rather than just "it raised" is what distinguishes
-- "the tenant scope caught it" from "the leader gate caught it": with the
-- operator clause deleted, this caller would fall through to the leader gate
-- and raise the SPANISH message instead, and a bare exception check would
-- have called that a pass.
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-b000-000000000645","operator_id":"bbbbbbbb-0000-4000-b000-000000000640","claims":{"operator_id":"bbbbbbbb-0000-4000-b000-000000000640"}}';
SET LOCAL ROLE authenticated;
-- A flag, not a sentinel RAISE inside the inner block, unlike TESTs 1 and 2:
-- the expected refusal here is a bare `RAISE EXCEPTION` (P0001, no ERRCODE),
-- which `WHEN OTHERS` cannot be narrowed away from -- a sentinel raised on
-- success would be swallowed by the same handler and reported as a confusing
-- message mismatch instead of "it succeeded". TESTs 1 and 2 can use the
-- typed `WHEN insufficient_privilege` handler because their sentinel is
-- P0001 and therefore escapes it.
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.cancel_pickup_route('77777777-0000-4000-7000-000000000641'::uuid, 'no');
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a leader from another operator must not be able to cancel this route';
  END IF;
  IF msg NOT LIKE '%not found%' THEN
    RAISE EXCEPTION 'cross-operator call was refused by the wrong check (expected the route lookup), got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 4: an ELEVATED user cannot reach across operators either ──────────
-- The dangerous direction: operations_manager is authorised in general, so if
-- the role check ever ran before (or instead of) the operator-scoped lookup,
-- A's manager would be able to cancel B's routes. Same reasoning as TEST 3 for
-- asserting the message.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000644","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.cancel_pickup_route('77777777-0000-4000-7000-000000000645'::uuid, 'no');
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'an operations_manager must not be able to cancel another operator''s route';
  END IF;
  IF msg NOT LIKE '%not found%' THEN
    RAISE EXCEPTION 'cross-operator elevated call refused by the wrong check, got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 5: the operations_manager CAN cancel someone else's route ─────────
-- The escape hatch kept on purpose: an abandoned route has no other in-app
-- exit. Route 2 is driven by Lider Dos, so this is genuinely not her route —
-- with the elevated branch removed, this call raises instead of succeeding.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000644","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.pickup_routes;
BEGIN
  r := public.cancel_pickup_route('77777777-0000-4000-7000-000000000642'::uuid, 'Camion averiado');
  IF r.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'operations_manager cancel left the route in status %', r.status;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 6: the route's own driver can cancel it, reason and all ───────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000641","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.pickup_routes;
BEGIN
  r := public.cancel_pickup_route('77777777-0000-4000-7000-000000000641'::uuid, 'Cancelada por el líder de la ruta');
  IF r.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'the route driver could not cancel their own route, status is %', r.status;
  END IF;
  IF r.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'cancelled_at was not stamped';
  END IF;
  -- Proves this migration was templated on the spec-52 definition and not the
  -- spec-47 original, which dropped p_reason on the floor.
  IF r.cancellation_reason IS DISTINCT FROM 'Cancelada por el líder de la ruta' THEN
    RAISE EXCEPTION 'p_reason was not persisted, got: %', r.cancellation_reason;
  END IF;
END $$;
RESET ROLE;

-- ── Read back as the OWNER: both routes really are cancelled, B's is not ───
-- Owner on purpose (see the file header): RLS must not be able to turn "the
-- row was never written" into "the row is invisible to this reader".
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.pickup_routes
   WHERE id IN ('77777777-0000-4000-7000-000000000641','77777777-0000-4000-7000-000000000642')
     AND status = 'cancelled';
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected both operator-A routes cancelled, found %', n;
  END IF;

  SELECT COUNT(*) INTO n FROM public.pickup_routes
   WHERE id = '77777777-0000-4000-7000-000000000645' AND status = 'in_progress';
  IF n <> 1 THEN
    RAISE EXCEPTION 'operator B''s route was touched by an operator-A caller';
  END IF;
END $$;

ROLLBACK;
