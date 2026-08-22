-- add_manifest_to_route: who may push a load onto a pickup route.
--
-- The mirror image of the hole spec-61 closed on cancel_pickup_route
-- (20260821000001). The function checked the caller's OPERATOR and nothing
-- else, with EXECUTE granted to `authenticated`, so any user of an operator
-- could attach a manifest to any open route in it — including a stranger
-- loading cargas onto someone else's truck.
--
-- WHO MAY ADD, AND WHY IT IS NOT cancel_pickup_route's LIST.
-- Adding a load to the route you are working is the job; ending someone
-- else's shift is not. spec-61's get_my_active_pickup_route (20260820000005)
-- deliberately returns the route to LEADER **OR ACTIVE CREW**, so crew reach
-- /app/pickup/route/active and its AddManifestSheet by design. Gating this on
-- driver_id alone — the cancel rule — would break every crew member mid-shift.
-- So: the route's driver, an ACTIVE crew member of THAT route, or an
-- operations_manager / admin / super_admin. A `pickup_leader` who is neither
-- driver nor crew here gets nothing, exactly as in cancel: leading routes in
-- general is not authority over this one.
--
-- RUNS AS `authenticated` VIA `SET LOCAL ROLE`, for the reasons spelled out in
-- spec61_cancel_route_authz.sql: EXECUTE is granted to that role specifically,
-- and refusals must come from the function's own gate rather than from a
-- privilege the test connection happens to lack.
--
-- TWO OPERATORS, deliberately, so `operator_id = v_operator` in the route
-- lookup is falsifiable in both directions.
--
-- THE FIXTURE:
--   741 Lider Uno   pickup_leader, drives route 1      -> may add to route 1
--   742 Ana Perez   pickup_crew, ACTIVE on route 1     -> may add to route 1
--   743 Lider Dos   pickup_leader, drives route 2      -> refused on route 1
--   744 Jefa Ops    operations_manager, drives nothing -> may add to route 1
--   745 Ex Crew     pickup_crew, removed_at set on r1  -> refused on route 1
--   B746 Otro Lider operator B, drives route X         -> refused on route 1

BEGIN;

INSERT INTO public.operators (id, name, slug) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000740','AMTR Authz','amtr-authz'),
  ('bbbbbbbb-0000-4000-b000-000000000740','AMTR Authz Other','amtr-authz-other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000741','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','amtr-leader1@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000742','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','amtr-crew@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000743','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','amtr-leader2@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Dos"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000744','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','amtr-ops@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740","role":"operations_manager"}'::jsonb,
   '{"full_name":"Jefa Ops"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000745','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','amtr-excrew@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ex Crew"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000746','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','amtr-otherleader@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000740","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Otro Lider"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows, and
-- the gate reads `role` from public.users rather than the JWT claim.
INSERT INTO public.users (id, operator_id, email, full_name, role, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000741','aaaaaaaa-0000-4000-a000-000000000740','amtr-leader1@test.test','Lider Uno','pickup_leader',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000742','aaaaaaaa-0000-4000-a000-000000000740','amtr-crew@test.test','Ana Perez','pickup_crew',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000743','aaaaaaaa-0000-4000-a000-000000000740','amtr-leader2@test.test','Lider Dos','pickup_leader',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000744','aaaaaaaa-0000-4000-a000-000000000740','amtr-ops@test.test','Jefa Ops','operations_manager',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000745','aaaaaaaa-0000-4000-a000-000000000740','amtr-excrew@test.test','Ex Crew','pickup_crew',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000746','bbbbbbbb-0000-4000-b000-000000000740','amtr-otherleader@test.test','Otro Lider','pickup_leader',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      role        = EXCLUDED.role,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000741','aaaaaaaa-0000-4000-a000-000000000740','AMTR-V1', true),
  ('99999999-0000-4000-9000-000000000743','aaaaaaaa-0000-4000-a000-000000000740','AMTR-V2', true),
  ('99999999-0000-4000-9000-000000000746','bbbbbbbb-0000-4000-b000-000000000740','AMTR-VB', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('77777777-0000-4000-7000-000000000741','aaaaaaaa-0000-4000-a000-000000000740','PR-AMTR-1',
   'aaaaaaaa-0000-4000-a000-000000000741','99999999-0000-4000-9000-000000000741','in_progress'),
  ('77777777-0000-4000-7000-000000000743','aaaaaaaa-0000-4000-a000-000000000740','PR-AMTR-2',
   'aaaaaaaa-0000-4000-a000-000000000743','99999999-0000-4000-9000-000000000743','in_progress'),
  ('77777777-0000-4000-7000-000000000746','bbbbbbbb-0000-4000-b000-000000000740','PR-AMTR-B',
   'bbbbbbbb-0000-4000-b000-000000000746','99999999-0000-4000-9000-000000000746','in_progress');

INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by, removed_at) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000740','77777777-0000-4000-7000-000000000741',
   'aaaaaaaa-0000-4000-a000-000000000742','aaaaaaaa-0000-4000-a000-000000000741', NULL),
  ('aaaaaaaa-0000-4000-a000-000000000740','77777777-0000-4000-7000-000000000741',
   'aaaaaaaa-0000-4000-a000-000000000745','aaaaaaaa-0000-4000-a000-000000000741', NOW());

-- One manifest per attempt: a successful add attaches it, so sharing rows
-- between cases would make later assertions depend on earlier ones.
INSERT INTO public.manifests (id, operator_id, external_load_id, status) VALUES
  ('eeee0740-0000-4000-e000-000000000741','aaaaaaaa-0000-4000-a000-000000000740','CARGA-AMTR-LEADER','pending'),
  ('eeee0740-0000-4000-e000-000000000742','aaaaaaaa-0000-4000-a000-000000000740','CARGA-AMTR-CREW','pending'),
  ('eeee0740-0000-4000-e000-000000000743','aaaaaaaa-0000-4000-a000-000000000740','CARGA-AMTR-STRANGER','pending'),
  ('eeee0740-0000-4000-e000-000000000744','aaaaaaaa-0000-4000-a000-000000000740','CARGA-AMTR-OPS','pending'),
  ('eeee0740-0000-4000-e000-000000000745','aaaaaaaa-0000-4000-a000-000000000740','CARGA-AMTR-EXCREW','pending'),
  ('eeee0740-0000-4000-e000-000000000746','aaaaaaaa-0000-4000-a000-000000000740','CARGA-AMTR-CROSS','pending');

-- Pins the assumption the whole file rests on: this connection bypasses RLS,
-- so every refusal below must come from the function, not from invisibility.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE id IN ('aaaaaaaa-0000-4000-a000-000000000740','bbbbbbbb-0000-4000-b000-000000000740');
  IF c <> 2 THEN
    RAISE EXCEPTION 'owner context saw % of 2 fixture operators — this file MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ── TEST 1: the route's own driver may add ────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000741","operator_id":"aaaaaaaa-0000-4000-a000-000000000740","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.add_manifest_to_route(
    '77777777-0000-4000-7000-000000000741'::uuid,'eeee0740-0000-4000-e000-000000000741'::uuid);
END $$;
RESET ROLE;

-- ── TEST 2: an ACTIVE CREW member of the route may add ────────────────────
-- The case that rules out copying cancel_pickup_route's driver-only gate.
-- Crew reach this screen by design (get_my_active_pickup_route), and loading
-- the truck they are riding is the job.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000742","operator_id":"aaaaaaaa-0000-4000-a000-000000000740","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.add_manifest_to_route(
    '77777777-0000-4000-7000-000000000741'::uuid,'eeee0740-0000-4000-e000-000000000742'::uuid);
END $$;
RESET ROLE;

-- ── TEST 3: a DIFFERENT leader in the same operator may NOT add ───────────
-- The defect this migration exists for, and the row that proves pickup_leader
-- is not an elevated role here.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000743","operator_id":"aaaaaaaa-0000-4000-a000-000000000740","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.add_manifest_to_route(
      '77777777-0000-4000-7000-000000000741'::uuid,'eeee0740-0000-4000-e000-000000000743'::uuid);
    RAISE EXCEPTION 'a leader of another route must not be able to load this one';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  -- Reaches the driver verbatim (useAddManifestToRoute rethrows RPC messages).
  IF msg NOT LIKE '%Solo la tripulación de esta ruta%' THEN
    RAISE EXCEPTION 'refusal message is not the Spanish one the UI shows: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 4: a REMOVED crew member may NOT add ─────────────────────────────
-- removed_at is how spec-61 ends a seat. A stale row must not keep authority.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000745","operator_id":"aaaaaaaa-0000-4000-a000-000000000740","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.add_manifest_to_route(
      '77777777-0000-4000-7000-000000000741'::uuid,'eeee0740-0000-4000-e000-000000000745'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a crew member with removed_at set must not be able to load the route';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 5: an operations_manager MAY add to someone else's route ─────────
-- The escape hatch kept on purpose, matching cancel_pickup_route.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000744","operator_id":"aaaaaaaa-0000-4000-a000-000000000740","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000740"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.add_manifest_to_route(
    '77777777-0000-4000-7000-000000000741'::uuid,'eeee0740-0000-4000-e000-000000000744'::uuid);
END $$;
RESET ROLE;

-- ── TEST 6: no reaching across operators ──────────────────────────────────
-- Refused by the OPERATOR-scoped route lookup, before the role check — so the
-- message must be 'not found', not the Spanish refusal.
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-b000-000000000746","operator_id":"bbbbbbbb-0000-4000-b000-000000000740","claims":{"operator_id":"bbbbbbbb-0000-4000-b000-000000000740"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.add_manifest_to_route(
      '77777777-0000-4000-7000-000000000741'::uuid,'eeee0740-0000-4000-e000-000000000746'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a leader of another operator must not be able to load this route';
  END IF;
  IF msg NOT LIKE '%not found%' THEN
    RAISE EXCEPTION 'cross-operator call refused by the wrong check, got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- Read back as the OWNER: what is under test is who the FUNCTION let act, and
-- a post-hoc read through RLS would conflate a refusal with an invisible row.
DO $$
DECLARE attached INT;
BEGIN
  SELECT COUNT(*) INTO attached FROM public.manifests
   WHERE pickup_route_id = '77777777-0000-4000-7000-000000000741';
  IF attached <> 3 THEN
    RAISE EXCEPTION 'expected exactly the 3 permitted adds to have landed, found %', attached;
  END IF;
END $$;

ROLLBACK;
