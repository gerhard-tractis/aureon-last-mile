-- spec-61 Task 4 — get_my_active_pickup_route(): leader OR active crew.
--
-- Fixture note: FOUR people, not three. `mine-other` holds NO crew row at all
-- and `mine-removed` holds a crew row whose removed_at is already stamped while
-- the route is still in_progress. Both must get NULL, and they get it for
-- DIFFERENT reasons -- without the removed one, `c.removed_at IS NULL` in the
-- EXISTS and in the crew aggregate would both be unfalsifiable here, because
-- every crew row in the fixture would be active.
BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000630','Spec61 Mine','spec61-mine')
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
   '{"full_name":"Zoe Bajada"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000631','aaaaaaaa-0000-4000-a000-000000000630','pickup_leader','mine-leader@spec61.test','Marta Rojas',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000632','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-crew@spec61.test','Ana Perez',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000633','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-other@spec61.test','Nadie',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000634','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-removed@spec61.test','Zoe Bajada',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000631','aaaaaaaa-0000-4000-a000-000000000630','AAA-111', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('77777777-0000-4000-7000-000000000631','aaaaaaaa-0000-4000-a000-000000000630',
        'PR-61-M','aaaaaaaa-0000-4000-a000-000000000631','99999999-0000-4000-9000-000000000631','in_progress');

INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by, removed_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
        'aaaaaaaa-0000-4000-a000-000000000632','aaaaaaaa-0000-4000-a000-000000000631', NULL),
       -- Someone who was on this trip and is not any more, while the route
       -- itself is still open.
       ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
        'aaaaaaaa-0000-4000-a000-000000000634','aaaaaaaa-0000-4000-a000-000000000631', NOW());

-- The leader sees it, with the plate, their name, and the ACTIVE crew only.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000631","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j IS NULL THEN RAISE EXCEPTION 'the leader must see their own route'; END IF;
  IF j->>'code' <> 'PR-61-M' THEN RAISE EXCEPTION 'wrong route: %', j->>'code'; END IF;
  IF j->>'plate' <> 'AAA-111' THEN RAISE EXCEPTION 'plate not joined: %', j; END IF;
  IF j->>'driver_name' <> 'Marta Rojas' THEN RAISE EXCEPTION 'driver name not joined: %', j; END IF;
  -- Exactly one: Zoe holds a removed seat on this same open route and must not
  -- appear. That is what makes removed_at load-bearing in the aggregate.
  IF jsonb_array_length(j->'crew') <> 1
     OR j->'crew'->0->>'full_name' <> 'Ana Perez' THEN
    RAISE EXCEPTION 'crew missing from or over-full in the payload: %', j->'crew';
  END IF;
END $$;

-- The crew member sees the SAME route.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000632","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
DO $$
DECLARE j JSONB;
BEGIN
  j := public.get_my_active_pickup_route();
  IF j IS NULL OR j->>'id' <> '77777777-0000-4000-7000-000000000631' THEN
    RAISE EXCEPTION 'active crew must see the route they are on, got %', j;
  END IF;
END $$;

-- Someone on no route sees nothing.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000633","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a person on no route must get NULL';
  END IF;
END $$;

-- A REMOVED seat on a still-open route is not a seat.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000634","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a removed crew member must not still see the route';
  END IF;
END $$;

-- A soft-deleted route is nobody route. Checked on the LEADER and BEFORE the
-- status change: deleted_at leaves status at in_progress and the leader holds
-- no crew row, so this is the only assertion here that pins deleted_at IS NULL.
--
-- ORDER IS LOAD-BEARING. Move this block below the in_transit UPDATE and it
-- stops being able to fail: status would already be off in_progress, so
-- deleting `pr.deleted_at IS NULL` from the function would still leave the
-- leader with NULL. Keep the soft-delete case first, on a route that is still
-- open.
UPDATE public.pickup_routes SET deleted_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000631';

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000631","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a soft-deleted route must stop being my route';
  END IF;
END $$;

-- Undelete, then close the route for real. trg_pickup_route_crew_sync
-- restores BOTH seats on the way back to in_progress -- Ana and Zoe alike,
-- since neither holds an active seat anywhere else -- so Zoe is no longer a
-- removed member after this point. Nothing below asserts her state, and the
-- assertions that needed her removed are all above.
UPDATE public.pickup_routes SET deleted_at = NULL
 WHERE id = '77777777-0000-4000-7000-000000000631';
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000631';

-- Once the route closes, the LEADER is back to nothing. Same reasoning as the
-- soft-delete case: the leader holds no crew row, so only status = in_progress
-- can produce this NULL.
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a closed route must stop being the route of its leader';
  END IF;
END $$;

-- ...and so is the crew member.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000632","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
DO $$ BEGIN
  IF public.get_my_active_pickup_route() IS NOT NULL THEN
    RAISE EXCEPTION 'a closed route must stop being my route';
  END IF;
END $$;

ROLLBACK;
