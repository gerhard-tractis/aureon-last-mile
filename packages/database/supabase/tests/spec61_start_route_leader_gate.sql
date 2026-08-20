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

-- ── Rollout backfill: role+permission ARE proven at deploy time ────────────
-- Spec-61's Rollout block requires the promotion to apply role AND the
-- pickup permission. That the real backfill (20260820000003 PART 1) does
-- both, against the real rows, is now proven by that migration's own PART 3
-- validation block (asserts zero pickup_crew rows survive it) -- run once,
-- at deploy time, against production. A pgTAP test executing afterward
-- cannot re-observe that historical run; re-implementing PART 1's WHERE
-- clause against a fixture here would only prove a hand-copied duplicate
-- behaves, which stays green even if PART 1 itself is deleted -- see PART 3's
-- header in that migration for the full reasoning.
--
-- What IS this test's business is the CASE expression's semantics in
-- isolation: given an account that already carries an extra permission, does
-- "guarantee pickup" ADD it rather than reset the array? That is a property
-- of the expression, not of which rows the migration targets.
DO $$
DECLARE v_perms TEXT[];
BEGIN
  -- Already has 'pickup' plus something else: expression must be a no-op.
  SELECT CASE WHEN 'pickup' = ANY(p) THEN p ELSE p || ARRAY['pickup']::TEXT[] END
    INTO v_perms FROM (VALUES (ARRAY['pickup','reception']::TEXT[])) AS t(p);
  IF NOT ('pickup' = ANY(v_perms) AND 'reception' = ANY(v_perms) AND array_length(v_perms,1) = 2) THEN
    RAISE EXCEPTION 'additive-permissions expression should leave an existing pickup+reception array untouched, got %', v_perms;
  END IF;

  -- Missing 'pickup': expression must APPEND it, not replace the array.
  SELECT CASE WHEN 'pickup' = ANY(p) THEN p ELSE p || ARRAY['pickup']::TEXT[] END
    INTO v_perms FROM (VALUES (ARRAY['reception']::TEXT[])) AS t(p);
  IF NOT ('pickup' = ANY(v_perms) AND 'reception' = ANY(v_perms) AND array_length(v_perms,1) = 2) THEN
    RAISE EXCEPTION 'additive-permissions expression should append pickup while keeping reception, got %', v_perms;
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
  -- No "removed_at IS NULL" clause: nothing in this test ever sets removed_at
  -- (that's trg_pickup_route_crew_sync's job, spec-61 Task 1.2), so adding it
  -- here would assert nothing extra -- just the row count.
  SELECT count(*) INTO n FROM public.pickup_route_crew
   WHERE pickup_route_id = r.id AND user_id = 'aaaaaaaa-0000-4000-a000-000000000622';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the crew member should be on the route exactly once, found %', n;
  END IF;
END $$;

-- ── Cross-operator crew refusal: the multi-tenancy guard ────────────────────
-- Nothing else in this file exercises the crew pre-flight's operator_id scope
-- (the equivalent of :180-184 in 20260820000003) -- the highest-risk line in
-- the function, since a hole here lets a leader pull a stranger from another
-- tenant onto their route. Reuses leader ...621 and vehicle ...621: the crew
-- pre-flight runs BEFORE the route insert, so this refusal fires even though
-- that leader already has an active route -- it never gets far enough to hit
-- the "ya tiene una ruta activa" check.
INSERT INTO public.operators (id, name, slug)
VALUES ('bbbbbbbb-0000-4000-b000-000000000620','Spec61 Gate Other','spec61-gate-other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('bbbbbbbb-0000-4000-b000-000000000625','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gate-other-op@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000620","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Otro Operador"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('bbbbbbbb-0000-4000-b000-000000000625','bbbbbbbb-0000-4000-b000-000000000620','pickup_crew',
   'gate-other-op@spec61.test','Otro Operador',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000621","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.start_pickup_route(
              '99999999-0000-4000-9000-000000000621'::uuid,
              ARRAY['bbbbbbbb-0000-4000-b000-000000000625']::uuid[]);
    RAISE EXCEPTION 'a crew member from a different operator must be refused';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE '%no pertenece a este operador%' THEN
    RAISE EXCEPTION 'cross-operator refusal message unexpected: %', msg;
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
  -- This message check is the WHOLE assertion here, deliberately: a row-count
  -- check ("did it create nothing") would pass even with the pre-flight
  -- removed, because this DO block's EXCEPTION handler rolls back whatever
  -- the failed statement attempted regardless of which statement failed.
  -- Only the message proves the pre-flight fired before any write.
  IF msg NOT LIKE '%Ana Perez%' OR msg NOT LIKE '%PR-%' THEN
    RAISE EXCEPTION 'the refusal must name the person and the route, got: %', msg;
  END IF;
END $$;

-- The one-argument call still resolves (frontend mid-deploy, and the TEXT wrapper).
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000623","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';
DO $$
DECLARE r public.pickup_routes;
BEGIN
  -- The call itself is the assertion: if the one-argument form no longer
  -- resolves (or resolves ambiguously), this raises and the test fails.
  -- An "IF r.id IS NULL" check afterward would be inert -- resolution
  -- failure aborts the block before reaching it, and success always yields
  -- a non-null r.id (NOT NULL primary key).
  r := public.start_pickup_route(p_vehicle_id => '99999999-0000-4000-9000-000000000622'::uuid);
END $$;

ROLLBACK;
