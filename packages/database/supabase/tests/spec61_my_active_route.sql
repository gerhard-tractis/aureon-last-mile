-- spec-61 Task 4 — get_my_active_pickup_route(): leader OR active crew.
--
-- Runs as `authenticated` via SET LOCAL ROLE, not as the owner: the function
-- is SECURITY INVOKER and its whole premise is that the four tables it reads
-- (pickup_routes, pickup_route_crew, vehicles, users) carry OPERATOR-scoped
-- SELECT policies rather than driver-scoped ones. Asserted from an owner
-- connection, which Postgres exempts from RLS, that premise is tested by
-- nothing. See the guard below.
--
-- Every comparison is IS DISTINCT FROM, never <>. A missing key yields SQL
-- NULL, `NULL <> 'x'` is NULL, and `IF NULL THEN` does not fire -- so `<>`
-- turns "the function stopped emitting this key at all" into a PASS, which is
-- the exact class of assertion this file must not contain.
--
-- THE FIXTURE, and why each row exists:
--   631 Marta Rojas   leader of route 1                  -> sees route 1
--   632 Ana Perez     active crew on route 1             -> sees route 1
--                     ...and, deliberately, a MIS-TENANTED active crew row on
--                     operator B's route: the only way pr.operator_id can be
--                     made falsifiable (see TEST 3)
--   633 Nadie         no seat anywhere                   -> NULL
--   634 Zoe Bajada    REMOVED seat on the still-open route 1 -> NULL, and
--                     absent from the leader's crew array
--   635 Solo Lider    leader of route 2, WITHOUT crew    -> crew = []
--                     then route 2 is soft-deleted       -> NULL
--   636 Dual Persona  crew on route 1 AND leader of the newer route 3
--                     -> the ORDER BY/LIMIT tiebreak
--   637 (soft-deleted user) active crew on route 1       -> still counted,
--                     with a NULL name: the LEFT JOIN in the crew aggregate
--   B631 Otro Lider   operator B, own route              -> never visible to A
--
-- Route 2 exists so the soft-delete case has its OWN route and its OWN leader:
-- asserting deleted_at on route 1 would only be falsifiable while route 1 is
-- still in_progress, i.e. it would depend on statement order. It does not now.
BEGIN;

INSERT INTO public.operators (id, name, slug) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000630','Spec61 Mine','spec61-mine'),
  ('bbbbbbbb-0000-4000-b000-000000000630','Spec61 Theirs','spec61-theirs')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000631','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Marta Rojas"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000632','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000633','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-other@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Nadie"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000634','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-removed@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Zoe Bajada"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000635','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-solo@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Solo Lider"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000636','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-dual@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Dual Persona"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000637','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mine-ghost@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Fantasma"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000631','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','theirs-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000630","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Otro Lider"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- 637 is soft-deleted: still a real crew row on an open route, but invisible
-- through users_tenant_isolation_select, which filters deleted_at IS NULL.
INSERT INTO public.users (id, operator_id, role, email, full_name, permissions, deleted_at) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000631','aaaaaaaa-0000-4000-a000-000000000630','pickup_leader','mine-leader@spec61.test','Marta Rojas',ARRAY['pickup'], NULL),
  ('aaaaaaaa-0000-4000-a000-000000000632','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-crew@spec61.test','Ana Perez',ARRAY['pickup'], NULL),
  ('aaaaaaaa-0000-4000-a000-000000000633','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-other@spec61.test','Nadie',ARRAY['pickup'], NULL),
  ('aaaaaaaa-0000-4000-a000-000000000634','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-removed@spec61.test','Zoe Bajada',ARRAY['pickup'], NULL),
  ('aaaaaaaa-0000-4000-a000-000000000635','aaaaaaaa-0000-4000-a000-000000000630','pickup_leader','mine-solo@spec61.test','Solo Lider',ARRAY['pickup'], NULL),
  ('aaaaaaaa-0000-4000-a000-000000000636','aaaaaaaa-0000-4000-a000-000000000630','pickup_leader','mine-dual@spec61.test','Dual Persona',ARRAY['pickup'], NULL),
  ('aaaaaaaa-0000-4000-a000-000000000637','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-ghost@spec61.test','Fantasma',ARRAY['pickup'], NOW()),
  ('bbbbbbbb-0000-4000-b000-000000000631','bbbbbbbb-0000-4000-b000-000000000630','pickup_leader','theirs-leader@spec61.test','Otro Lider',ARRAY['pickup'], NULL)
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions,
      deleted_at = EXCLUDED.deleted_at;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000631','aaaaaaaa-0000-4000-a000-000000000630','AAA-111', true),
  ('99999999-0000-4000-9000-000000000632','aaaaaaaa-0000-4000-a000-000000000630','BBB-222', true),
  ('99999999-0000-4000-9000-000000000633','aaaaaaaa-0000-4000-a000-000000000630','CCC-333', true),
  ('99999999-0000-4000-9000-00000000063b','bbbbbbbb-0000-4000-b000-000000000630','ZZZ-999', true)
ON CONFLICT DO NOTHING;

-- started_at descends deliberately: operator B's route is the NEWEST, so if
-- the operator filter were dropped it would win the ORDER BY and TEST 3 would
-- return the wrong route rather than merely a possible one.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, started_at) VALUES
  ('77777777-0000-4000-7000-000000000631','aaaaaaaa-0000-4000-a000-000000000630',
   'PR-61-M','aaaaaaaa-0000-4000-a000-000000000631','99999999-0000-4000-9000-000000000631','in_progress', NOW() - INTERVAL '2 hours'),
  ('77777777-0000-4000-7000-000000000632','aaaaaaaa-0000-4000-a000-000000000630',
   'PR-61-S','aaaaaaaa-0000-4000-a000-000000000635','99999999-0000-4000-9000-000000000632','in_progress', NOW() - INTERVAL '90 minutes'),
  ('77777777-0000-4000-7000-000000000633','aaaaaaaa-0000-4000-a000-000000000630',
   'PR-61-D','aaaaaaaa-0000-4000-a000-000000000636','99999999-0000-4000-9000-000000000633','in_progress', NOW() - INTERVAL '30 minutes'),
  ('77777777-0000-4000-7000-00000000063b','bbbbbbbb-0000-4000-b000-000000000630',
   'PR-61-X','bbbbbbbb-0000-4000-b000-000000000631','99999999-0000-4000-9000-00000000063b','in_progress', NOW());

INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by, removed_at) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
   'aaaaaaaa-0000-4000-a000-000000000632','aaaaaaaa-0000-4000-a000-000000000631', NULL),
  ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
   'aaaaaaaa-0000-4000-a000-000000000636','aaaaaaaa-0000-4000-a000-000000000631', NULL),
  ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
   'aaaaaaaa-0000-4000-a000-000000000637','aaaaaaaa-0000-4000-a000-000000000631', NULL),
  -- Was on this trip, is not any more, while the route is still open.
  ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
   'aaaaaaaa-0000-4000-a000-000000000634','aaaaaaaa-0000-4000-a000-000000000631', NOW()),
  -- MIS-TENANTED ON PURPOSE: an operator-A person seated on an operator-B
  -- route. Nothing in the schema forbids it (the unique index is per
  -- (operator_id, user_id), so this does not collide with her real seat
  -- above), and it is the only fixture that can distinguish
  -- `pr.operator_id = me.op` from its absence -- every honest row is already
  -- confined to one operator by the leader-or-crew predicate itself.
  ('bbbbbbbb-0000-4000-b000-000000000630','77777777-0000-4000-7000-00000000063b',
   'aaaaaaaa-0000-4000-a000-000000000632','bbbbbbbb-0000-4000-b000-000000000631', NULL);

-- ─── GUARD: the connection role bypasses RLS, so SET ROLE is mandatory ─────
-- Template: rls_operators_test.sql:75-88 and rbac_users_test.sql:107-118.
-- If a future edit drops the `SET LOCAL ROLE authenticated` lines below, every
-- assertion in this file silently stops testing the SECURITY INVOKER premise.
-- Pin it: as the owner we must see BOTH operators.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE slug IN ('spec61-mine','spec61-theirs');
  IF c <> 2 THEN
    RAISE EXCEPTION
      'owner context saw % of 2 fixture operators — this file assumes the connection role bypasses RLS and therefore MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ── TEST 1: the leader sees the route, the plate, their name, active crew ──
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000631","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j IS NULL THEN RAISE EXCEPTION 'the leader must see their own route'; END IF;
  IF j->>'code'        IS DISTINCT FROM 'PR-61-M'    THEN RAISE EXCEPTION 'wrong route: %', j; END IF;
  IF j->>'plate'       IS DISTINCT FROM 'AAA-111'    THEN RAISE EXCEPTION 'plate not joined: %', j; END IF;
  IF j->>'driver_name' IS DISTINCT FROM 'Marta Rojas' THEN RAISE EXCEPTION 'driver name not joined: %', j; END IF;
  -- Exactly these three, in this order.
  --   Zoe (634) holds a REMOVED seat on this same open route and must not
  --   appear -- that is what makes removed_at load-bearing in the aggregate.
  --   637 is a SOFT-DELETED user and must appear anyway, with a null name:
  --   the aggregate LEFT-joins users, so a departed colleague still counts
  --   towards the head count the leader reads on 3h. Switch that join back to
  --   an inner one and this drops to two entries.
  IF j->'crew' IS DISTINCT FROM
     '[{"user_id":"aaaaaaaa-0000-4000-a000-000000000632","full_name":"Ana Perez"},
       {"user_id":"aaaaaaaa-0000-4000-a000-000000000636","full_name":"Dual Persona"},
       {"user_id":"aaaaaaaa-0000-4000-a000-000000000637","full_name":null}]'::jsonb THEN
    RAISE EXCEPTION 'wrong crew payload: %', j->'crew';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 2: a crew member sees the SAME route, read under RLS ──────────────
-- This is the assertion the whole task exists for, and running it as
-- `authenticated` is what makes it mean anything: it passes only because
-- pickup_routes/vehicles/users/pickup_route_crew are all operator-scoped, not
-- driver-scoped.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000632","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j IS NULL OR j->>'id' IS DISTINCT FROM '77777777-0000-4000-7000-000000000631' THEN
    RAISE EXCEPTION 'active crew must see the route they are on, got %', j;
  END IF;
  -- Ana also holds a seat on operator B's newer route. RLS alone should stop
  -- that one reaching her.
  IF j->>'code' IS DISTINCT FROM 'PR-61-M' THEN
    RAISE EXCEPTION 'cross-tenant leak under RLS: %', j->>'code';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 3: pr.operator_id, with RLS deliberately OUT of the way ───────────
-- Same caller, same mis-tenanted seat, but as the OWNER, which Postgres
-- exempts from RLS. RLS can no longer produce the right answer, so only
-- `pr.operator_id = me.op` inside the function can -- delete that line and
-- operator B's route (the newest of the two) wins the ORDER BY and this
-- fails. Defence in depth for the CLAUDE.md operator_id rule, and the reason
-- the mis-tenanted crew row above exists.
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j->>'code' IS DISTINCT FROM 'PR-61-M' THEN
    RAISE EXCEPTION 'the function itself must scope by operator, not lean on RLS: %', j->>'code';
  END IF;
END $$;

-- ── TEST 4: someone on no route at all sees nothing ────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000633","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a person on no route must get NULL';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 5: a REMOVED seat on a still-open route is not a seat ─────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000634","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a removed crew member must not still see the route';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 6: crew on one route, leader of a newer one -> the newer one ──────
-- Reachable state: uniq_pickup_routes_one_active_per_driver and
-- uniq_pickup_route_crew_one_active_per_user are separate indexes and neither
-- excludes the other. Without ORDER BY ... LIMIT 1 the function would return
-- whichever row the planner emitted first.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000636","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j IS NULL OR j->>'code' IS DISTINCT FROM 'PR-61-D' THEN
    RAISE EXCEPTION 'the newest open route must win, got %', j->>'code';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 7: a leader riding alone gets an EMPTY crew array, not null ───────
-- The hook does `crew ?? []` as well; this is the DB half of that pair, and
-- it is what makes the COALESCE in the function falsifiable.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000635","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j IS NULL OR j->>'code' IS DISTINCT FROM 'PR-61-S' THEN
    RAISE EXCEPTION 'the solo leader must see their own route, got %', j->>'code';
  END IF;
  IF j->'crew' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'a crew-less route must carry an empty array, got %', j->'crew';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 8: a soft-deleted route is nobody route ───────────────────────────
-- On route 2, whose leader holds no crew row and whose status stays
-- in_progress, so `pr.deleted_at IS NULL` is the only clause that can produce
-- this NULL -- and it stays that way regardless of what any other test does
-- to any other route.
UPDATE public.pickup_routes SET deleted_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000632';

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000635","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a soft-deleted route must stop being my route';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 9: a closed route stops being the route of its leader ─────────────
-- On route 1, asserted as the LEADER: he holds no crew row, so only
-- `status = 'in_progress'` can produce this NULL.
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000631';

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000631","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a closed route must stop being the route of its leader';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 10: ...and stops being the route of its crew ──────────────────────
-- Doubly protected (status here, and removed_at stamped by
-- trg_pickup_route_crew_sync), so this one cannot fail against either clause
-- alone. Kept as end-to-end coverage of the trigger + function pair, not as a
-- unit assertion; TEST 5 and TEST 9 are the falsifiable halves.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000632","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a closed route must stop being my route';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
