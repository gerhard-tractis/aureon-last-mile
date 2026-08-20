-- spec-61 Task 2 — only a leader may open a route; the crew lands in the same
-- transaction; a picker already on a trip is refused by name.
BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000620','Spec61 Gate','spec61-gate')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000621','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gate-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Gate"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000622','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gate-crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000623','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gate-leader2@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Dos"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000621','aaaaaaaa-0000-4000-a000-000000000620','pickup_leader','gate-leader@spec61.test','Lider Gate',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000622','aaaaaaaa-0000-4000-a000-000000000620','pickup_crew','gate-crew@spec61.test','Ana Perez',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000623','aaaaaaaa-0000-4000-a000-000000000620','pickup_leader','gate-leader2@spec61.test','Lider Dos',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000621','aaaaaaaa-0000-4000-a000-000000000620','VEH-62-1', true),
  ('99999999-0000-4000-9000-000000000622','aaaaaaaa-0000-4000-a000-000000000620','VEH-62-2', true)
ON CONFLICT DO NOTHING;

-- ── Rollout backfill: role AND permission, additively ───────────────────────
-- Spec-61's Rollout block is explicit: "The promotion must also apply the
-- pickup_leader permission default ... Assert this in the test -- the role
-- alone is not sufficient." The backfill itself (20260820000003 PART 1) is
-- one-shot DML that already ran, once, against whatever rows existed at
-- migration-apply time -- by the time THIS test executes, that historical
-- run cannot be re-observed on a genuinely pre-existing row, and there is no
-- reusable function to call again the way spec52_migration_reconciliation.sql
-- calls reconcile_abandoned_pickup_routes a second time. So this seeds a
-- fresh pickup_crew fixture and re-executes the EXACT statement PART 1 runs
-- (scoped to this fixture's id only, for test isolation -- the real
-- migration has no such scope), then asserts both effects it must have:
-- the ROLE flips to pickup_leader, and 'pickup' is guaranteed in
-- permissions WITHOUT dropping a permission ('reception') the account
-- already had -- proving the update is additive, not a reset.
-- Keep this in sync with 20260820000003 PART 1 by hand; there is nothing to
-- import it from.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000624','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gate-backfill@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Backfill Crew"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000624','aaaaaaaa-0000-4000-a000-000000000620','pickup_crew',
   'gate-backfill@spec61.test','Backfill Crew',ARRAY['pickup','reception'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

DO $$
DECLARE v_role public.user_role; v_perms TEXT[];
BEGIN
  -- Verbatim copy of 20260820000003 PART 1's UPDATE, plus "AND id = ..." to
  -- keep the blast radius to this one fixture row.
  UPDATE public.users
     SET role = 'pickup_leader',
         permissions = CASE WHEN 'pickup' = ANY(permissions)
                            THEN permissions
                            ELSE permissions || ARRAY['pickup']::TEXT[]
                       END
   WHERE role = 'pickup_crew'
     AND deleted_at IS NULL
     AND id = 'aaaaaaaa-0000-4000-a000-000000000624';

  SELECT role, permissions INTO v_role, v_perms FROM public.users
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000624';

  IF v_role IS DISTINCT FROM 'pickup_leader' THEN
    RAISE EXCEPTION 'backfill should promote a pickup_crew account to pickup_leader, got role %', v_role;
  END IF;
  IF NOT ('pickup' = ANY(v_perms)) THEN
    RAISE EXCEPTION 'backfill must guarantee the pickup permission -- role alone is not sufficient, got %', v_perms;
  END IF;
  IF NOT ('reception' = ANY(v_perms)) THEN
    RAISE EXCEPTION 'backfill must be additive: an existing reception permission was dropped, got %', v_perms;
  END IF;
END $$;

-- Act as the CREW member.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000622","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.start_pickup_route('99999999-0000-4000-9000-000000000621'::uuid);
    RAISE EXCEPTION 'a pickup_crew user must not be able to start a route';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  -- Shown to the driver verbatim: it must be Spanish, not a Postgres string.
  IF msg NOT LIKE '%líder%' THEN
    RAISE EXCEPTION 'refusal message is not the Spanish one the UI shows: %', msg;
  END IF;
END $$;

-- Act as the LEADER: route + crew in one call.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000621","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

DO $$
DECLARE r public.pickup_routes; n INT;
BEGIN
  r := public.start_pickup_route(
         '99999999-0000-4000-9000-000000000621'::uuid,
         ARRAY['aaaaaaaa-0000-4000-a000-000000000622']::uuid[]);
  IF r.driver_id <> 'aaaaaaaa-0000-4000-a000-000000000621' THEN
    RAISE EXCEPTION 'driver_id must be the leader, got %', r.driver_id;
  END IF;
  SELECT count(*) INTO n FROM public.pickup_route_crew
   WHERE pickup_route_id = r.id AND user_id = 'aaaaaaaa-0000-4000-a000-000000000622'
     AND removed_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'the crew member should be on the route exactly once, found %', n;
  END IF;
END $$;

-- A second leader cannot take a picker who is already out.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000623","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

DO $$
DECLARE msg TEXT := ''; n INT;
BEGIN
  BEGIN
    PERFORM public.start_pickup_route(
              '99999999-0000-4000-9000-000000000622'::uuid,
              ARRAY['aaaaaaaa-0000-4000-a000-000000000622']::uuid[]);
    RAISE EXCEPTION 'a picker already on a route must be refused';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE '%Ana Perez%' OR msg NOT LIKE '%PR-%' THEN
    RAISE EXCEPTION 'the refusal must name the person and the route, got: %', msg;
  END IF;
  -- and it must have created NOTHING.
  SELECT count(*) INTO n FROM public.pickup_routes
   WHERE driver_id = 'aaaaaaaa-0000-4000-a000-000000000623' AND status = 'in_progress';
  IF n <> 0 THEN
    RAISE EXCEPTION 'the refused call must not leave a route behind, found %', n;
  END IF;
END $$;

-- The one-argument call still resolves (frontend mid-deploy, and the TEXT wrapper).
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000623","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';
DO $$
DECLARE r public.pickup_routes;
BEGIN
  r := public.start_pickup_route(p_vehicle_id => '99999999-0000-4000-9000-000000000622'::uuid);
  IF r.id IS NULL THEN RAISE EXCEPTION 'one-argument call must still work'; END IF;
END $$;

ROLLBACK;
