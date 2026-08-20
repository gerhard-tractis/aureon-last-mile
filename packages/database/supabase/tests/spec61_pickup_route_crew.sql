-- spec-61 Task 1.2 — pickup_route_crew: shape, RLS (behavioural, not just
-- metadata), grant posture, one active seat per person, and removed_at
-- tracking the route's status through both the restore and the skip path.
BEGIN;

-- --- Fixture: operator A (the scenario under test) -------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000610','Spec61 Crew','spec61-crew')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000611','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000612','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows
-- (same pattern as tests/spec47_single_active_route_per_driver.sql:23).
INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000611','aaaaaaaa-0000-4000-a000-000000000610',
   'pickup_leader','leader@spec61.test','Lider Uno',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000610',
   'pickup_crew','crew@spec61.test','Ana Perez',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000611','aaaaaaaa-0000-4000-a000-000000000610','VEH-61-1', true),
  ('99999999-0000-4000-9000-000000000612','aaaaaaaa-0000-4000-a000-000000000610','VEH-61-2', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('77777777-0000-4000-7000-000000000611','aaaaaaaa-0000-4000-a000-000000000610',
   'PR-61-A','aaaaaaaa-0000-4000-a000-000000000611','99999999-0000-4000-9000-000000000611','in_progress');

-- --- Fixture: operator B (cross-tenant RLS control group) ------------------
-- Real cross-tenant assertion needs a real other tenant with real data,
-- the same shape spec52_vehicles_rls.sql and spec47_pickup_routes_rls.sql
-- use -- a policy row existing by name proves nothing about what it does.
INSERT INTO public.operators (id, name, slug)
VALUES ('bbbbbbbb-0000-4000-b000-000000000610','Spec61 Crew B','spec61-crew-b')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('bbbbbbbb-0000-4000-b000-000000000611','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','leader-b@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000610","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider B"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000612','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','crew-b@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000610","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Crew B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('bbbbbbbb-0000-4000-b000-000000000611','bbbbbbbb-0000-4000-b000-000000000610',
   'pickup_leader','leader-b@spec61.test','Lider B',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000612','bbbbbbbb-0000-4000-b000-000000000610',
   'pickup_crew','crew-b@spec61.test','Crew B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-b000-000000000611','bbbbbbbb-0000-4000-b000-000000000610','VEH-61-B', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('77777777-0000-4000-b000-000000000611','bbbbbbbb-0000-4000-b000-000000000610',
   'PR-61-B-OTHER','bbbbbbbb-0000-4000-b000-000000000611','99999999-0000-4000-b000-000000000611','in_progress');

INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
VALUES ('bbbbbbbb-0000-4000-b000-000000000610','77777777-0000-4000-b000-000000000611',
        'bbbbbbbb-0000-4000-b000-000000000612','bbbbbbbb-0000-4000-b000-000000000611');

-- 1. RLS is on and the tenant policy exists (sibling shape: vehicles, pickup_routes).
--    Metadata only -- a policy named right but written USING (true) would
--    still pass this. Assertion 4 below is the behavioural proof.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='pickup_route_crew' AND relrowsecurity) THEN
    RAISE EXCEPTION 'pickup_route_crew does not have RLS enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename='pickup_route_crew'
                    AND policyname='pickup_route_crew_tenant_isolation') THEN
    RAISE EXCEPTION 'pickup_route_crew_tenant_isolation policy missing';
  END IF;
END $$;

-- 2. Grant posture: authenticated has SELECT only. Not an RLS check -- this
--    must fail from the missing GRANT INSERT itself, before RLS's WITH
--    CHECK is even reached, so an accidental GRANT INSERT in a later
--    migration is what this assertion exists to catch (migration:147-155).
DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000611","operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000611',
            'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated should not be able to INSERT into pickup_route_crew (SELECT-only grant)';
  END IF;
  RESET role;
END $$;

-- 3. A crew seat can be taken (service-role context: start_pickup_route is
--    SECURITY DEFINER and bypasses the SELECT-only grant; this insert
--    stands in for it).
INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000611',
        'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');

-- 4. RLS, behaviourally: operator A's JWT sees operator A's crew row and
--    cannot see operator B's, matching spec52_vehicles_rls.sql /
--    spec47_pickup_routes_rls.sql.
DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000611","operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.pickup_route_crew
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000610';
  SELECT COUNT(*) INTO c_other FROM public.pickup_route_crew
   WHERE operator_id = 'bbbbbbbb-0000-4000-b000-000000000610';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own crew row, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B crew row, got %', c_other;
  END IF;
  RESET role;
END $$;

-- 5. The same person cannot hold a second active seat, and the named index says so.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('77777777-0000-4000-7000-000000000613','aaaaaaaa-0000-4000-a000-000000000610',
        'PR-61-B','aaaaaaaa-0000-4000-a000-000000000611','99999999-0000-4000-9000-000000000612','received');

DO $$
DECLARE rejected BOOLEAN := FALSE; con TEXT := '';
BEGIN
  BEGIN
    INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000613',
            'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE; GET STACKED DIAGNOSTICS con = CONSTRAINT_NAME;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'a second active crew seat for the same person should have been rejected';
  END IF;
  IF con <> 'uniq_pickup_route_crew_one_active_per_user' THEN
    RAISE EXCEPTION 'expected uniq_pickup_route_crew_one_active_per_user, got %', con;
  END IF;
END $$;

-- 6. Closing the route frees the seat (removed_at stamped by the trigger).
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000611';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.pickup_route_crew
              WHERE pickup_route_id='77777777-0000-4000-7000-000000000611'
                AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'crew of a closed route should have been stamped removed_at';
  END IF;
END $$;

-- 7. Reopening RESTORES the seat when its holder is free everywhere else.
--    At this point user '...612' holds no other active seat (the only
--    other row for them, on route '...613', was rejected by assertion 5
--    and never created) -- this is the plain, no-conflict restore path,
--    and the assertion is scoped to the exact row the UPDATE must touch so
--    a broken restore (dropped UPDATE, SET removed_at = NOW() instead of
--    NULL, or an inverted WHERE) fails here rather than being absorbed by
--    an unrelated row elsewhere.
UPDATE public.pickup_routes SET status = 'in_progress'
 WHERE id = '77777777-0000-4000-7000-000000000611';

DO $$
DECLARE v_removed_at TIMESTAMPTZ; v_found BOOLEAN := FALSE;
BEGIN
  SELECT removed_at, TRUE INTO v_removed_at, v_found FROM public.pickup_route_crew
   WHERE pickup_route_id = '77777777-0000-4000-7000-000000000611'
     AND user_id = 'aaaaaaaa-0000-4000-a000-000000000612'
     AND deleted_at IS NULL;
  IF NOT v_found THEN
    RAISE EXCEPTION 'expected seat row on route ...611 for user ...612, found none';
  END IF;
  IF v_removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'reopen should have restored the seat on route ...611 (removed_at IS NULL), got %', v_removed_at;
  END IF;
END $$;

-- 8. Reopening SKIPS restoring the seat when its holder genuinely holds an
--    active seat elsewhere -- built legitimately (a second route the person
--    is really, currently seated on), not by exploiting the AFTER-UPDATE-
--    only gap the way an earlier draft of this test did. This must keep
--    reproducing the skip after that gap is eventually closed.
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000611';

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('77777777-0000-4000-7000-000000000615','aaaaaaaa-0000-4000-a000-000000000610',
   'PR-61-C','aaaaaaaa-0000-4000-a000-000000000612','99999999-0000-4000-9000-000000000612','in_progress');

-- Legitimately active: route '...615' never changes status again in this
-- test, so trg_pickup_route_crew_sync never fires for it and this seat's
-- removed_at simply stays NULL from its own DEFAULT -- no reliance on the
-- AFTER-UPDATE-only limitation to hold it "active".
INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000615',
        'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');

UPDATE public.pickup_routes SET status = 'in_progress'
 WHERE id = '77777777-0000-4000-7000-000000000611';

DO $$
DECLARE v_removed_at TIMESTAMPTZ; v_elsewhere_removed_at TIMESTAMPTZ;
BEGIN
  SELECT removed_at INTO v_removed_at FROM public.pickup_route_crew
   WHERE pickup_route_id = '77777777-0000-4000-7000-000000000611'
     AND user_id = 'aaaaaaaa-0000-4000-a000-000000000612'
     AND deleted_at IS NULL;
  IF v_removed_at IS NULL THEN
    RAISE EXCEPTION 'known-limitation case broke: reopen restored the ...611 seat even though the holder is active on ...615';
  END IF;

  SELECT removed_at INTO v_elsewhere_removed_at FROM public.pickup_route_crew
   WHERE pickup_route_id = '77777777-0000-4000-7000-000000000615'
     AND user_id = 'aaaaaaaa-0000-4000-a000-000000000612'
     AND deleted_at IS NULL;
  IF v_elsewhere_removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'the elsewhere seat on ...615 should be untouched by the ...611 reopen, got removed_at %', v_elsewhere_removed_at;
  END IF;
END $$;

-- 9. handle_new_user gives a pickup_leader the pickup permission.
DO $$
DECLARE v_perms TEXT[];
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token
  ) VALUES (
    'aaaaaaaa-0000-4000-a000-000000000619','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','fresh-leader@spec61.test',
    crypt('x', gen_salt('bf')), NOW(),
    '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_leader"}'::jsonb,
    '{"full_name":"Lider Nuevo"}'::jsonb, NOW(), NOW(), '', ''
  );
  SELECT permissions INTO v_perms FROM public.users
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000619';
  IF NOT ('pickup' = ANY(v_perms)) THEN
    RAISE EXCEPTION 'a new pickup_leader must get the pickup permission, got %', v_perms;
  END IF;
END $$;

ROLLBACK;
