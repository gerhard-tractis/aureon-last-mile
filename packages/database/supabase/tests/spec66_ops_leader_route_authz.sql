-- ============================================================================
-- spec-66 — ops_leader: route authority and permission defaults
-- ============================================================================
-- Four things, in the order they can break:
--
--   0. handle_new_user gives a trigger-created ops_leader all four station
--      permissions and neither management token (migration 20260824000002).
--   1. an ops_leader MAY call start_pickup_route (migration 20260824000003).
--   2. a warehouse_staff HOLDING the 'pickup' permission still MAY NOT. This
--      is the regression the whole spec exists to fix, and the row that proves
--      permissions did not quietly become a way around the role gate. If this
--      test ever passes, the gate has been rewritten to read permissions and
--      spec-61's loud-failure property is gone.
--   3. 'ops_leader' does NOT appear in cancel_pickup_route's source. It
--      authorises the route's own driver_id regardless of role, which already
--      covers an ops_leader cancelling their own route; adding the role to its
--      manager override would repeat exactly what 20260821000001's own guard
--      forbids for pickup_leader. Leading routes is not authority over someone
--      else's route.
--
-- Fixture note (same as rbac_users_test.sql): rows are created by inserting
-- into auth.users and letting the on_auth_user_created trigger run
-- handle_new_user(). public.users is then upserted, because the gate reads
-- `role` from public.users rather than from the JWT claim.
--
-- Run inside a transaction; ROLLBACK at the end.
-- ============================================================================

BEGIN;

-- ── FIXTURE ────────────────────────────────────────────────────────────────

INSERT INTO public.operators (id, name, slug, country_code) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000660', 'Spec66 Operator', 'spec66-op', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000661','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec66-opsleader@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000660","role":"ops_leader"}'::jsonb,
   '{"full_name":"Jefa Piso"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000662','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec66-warehouse@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000660","role":"warehouse_staff"}'::jsonb,
   '{"full_name":"Bodega Con Pickup"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- ── TEST 0: the trigger's defaults for ops_leader ──────────────────────────
-- Asserted BEFORE the upsert below overwrites permissions, so this really is
-- handle_new_user's output and not the fixture's.
DO $$
DECLARE v_perms TEXT[];
BEGIN
  SELECT permissions INTO v_perms FROM public.users
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000661';

  IF v_perms IS NULL THEN
    RAISE EXCEPTION 'handle_new_user did not create the ops_leader row at all';
  END IF;

  IF NOT (v_perms @> ARRAY['pickup','reception','distribution','dispatch']
          AND array_length(v_perms, 1) = 4) THEN
    RAISE EXCEPTION 'ops_leader defaults are %, expected exactly the four stations', v_perms;
  END IF;

  -- A floor role, not a management one. Both tokens are checked explicitly:
  -- the length check above would catch a swap, but not a rename.
  IF 'customer_service' = ANY(v_perms) OR 'admin' = ANY(v_perms) THEN
    RAISE EXCEPTION 'ops_leader was granted a management token: %', v_perms;
  END IF;
END $$;

-- warehouse_staff is given 'pickup' DELIBERATELY — see TEST 2. This is the
-- exact configuration an admin would reach for as a workaround.
INSERT INTO public.users (id, operator_id, email, full_name, role, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000661','aaaaaaaa-0000-4000-a000-000000000660',
   'spec66-opsleader@test.test','Jefa Piso','ops_leader',
   ARRAY['pickup','reception','distribution','dispatch']),
  ('aaaaaaaa-0000-4000-a000-000000000662','aaaaaaaa-0000-4000-a000-000000000660',
   'spec66-warehouse@test.test','Bodega Con Pickup','warehouse_staff',
   ARRAY['pickup','reception','distribution'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      role        = EXCLUDED.role,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000661','aaaaaaaa-0000-4000-a000-000000000660','SPEC66-V1', true)
ON CONFLICT DO NOTHING;

-- ── TEST 1: an ops_leader MAY open a route ────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000661","operator_id":"aaaaaaaa-0000-4000-a000-000000000660","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000660"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_row public.pickup_routes;
BEGIN
  v_row := public.start_pickup_route('99999999-0000-4000-9000-000000000661'::uuid);
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'start_pickup_route returned no route for an ops_leader';
  END IF;
  IF v_row.driver_id <> 'aaaaaaaa-0000-4000-a000-000000000661' THEN
    RAISE EXCEPTION 'route was created under the wrong driver: %', v_row.driver_id;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 2: warehouse_staff + 'pickup' permission still MAY NOT ───────────
-- The regression guard. Permissions open SCREENS; role decides what may be
-- done inside Recogida. If this stops raising, that separation is gone.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000662","operator_id":"aaaaaaaa-0000-4000-a000-000000000660","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000660"}}';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.start_pickup_route('99999999-0000-4000-9000-000000000661'::uuid);
  RAISE EXCEPTION 'warehouse_staff opened a pickup route — the role gate now reads permissions';
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;  -- 42501, the expected refusal
END $$;
RESET ROLE;

-- ── TEST 3: ops_leader must NOT be in cancel_pickup_route ─────────────────
-- Mirrors the pickup_leader guard at 20260821000001:175.
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE proname = 'cancel_pickup_route'
     AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'cancel_pickup_route not found';
  END IF;

  IF v_src LIKE '%ops_leader%' THEN
    RAISE EXCEPTION 'cancel_pickup_route authorises ops_leader — leading routes is not authority over someone else''s route';
  END IF;
END $$;

ROLLBACK;
