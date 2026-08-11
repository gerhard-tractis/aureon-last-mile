-- spec-52 Task 4 — reconciliation of abandoned pickup routes.
--
-- WHY THIS TEST SEEDS ITS OWN FIXTURES:
-- the harness applies migrations first and runs tests afterwards, so by the
-- time this file executes 20260812000004 has already run — against whatever
-- rows existed then, which on a clean database is none. Asserting on the
-- production rows (PR-2026-0001, PR-LEGACY-*) would therefore pass vacuously
-- and prove nothing. Instead we seed rows that match the migration's
-- predicates and invoke the SAME function the migration called
-- (public.reconcile_abandoned_pickup_routes) against them.
--
-- Everything is scoped to one throwaway operator and rolled back.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000005204','Spec52 Reconcile','spec52-reconcile')
ON CONFLICT (slug) DO NOTHING;

-- Four drivers: uniq_pickup_routes_one_active_per_driver covers
-- (operator_id, driver_id) WHERE status = 'in_progress', so the two
-- in_progress fixtures below MUST belong to different drivers.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
)
SELECT
  d.id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  d.email, crypt('x', gen_salt('bf')), NOW(),
  '{"operator_id":"aaaaaaaa-0000-4000-a000-000000005204"}'::jsonb,
  jsonb_build_object('full_name', d.full_name), NOW(), NOW(), '', ''
FROM (VALUES
  ('dddddddd-0000-4000-d000-000000005201'::UUID,'d1-reconcile@spec52.test','Driver Abandoned'),
  ('dddddddd-0000-4000-d000-000000005202'::UUID,'d2-reconcile@spec52.test','Driver Recent'),
  ('dddddddd-0000-4000-d000-000000005203'::UUID,'d3-reconcile@spec52.test','Driver InTransit'),
  ('dddddddd-0000-4000-d000-000000005204'::UUID,'d4-reconcile@spec52.test','Driver Received')
) AS d(id, email, full_name)
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
SELECT d.id, 'aaaaaaaa-0000-4000-a000-000000005204', d.email, d.full_name, ARRAY['pickup']
FROM (VALUES
  ('dddddddd-0000-4000-d000-000000005201'::UUID,'d1-reconcile@spec52.test','Driver Abandoned'),
  ('dddddddd-0000-4000-d000-000000005202'::UUID,'d2-reconcile@spec52.test','Driver Recent'),
  ('dddddddd-0000-4000-d000-000000005203'::UUID,'d3-reconcile@spec52.test','Driver InTransit'),
  ('dddddddd-0000-4000-d000-000000005204'::UUID,'d4-reconcile@spec52.test','Driver Received')
) AS d(id, email, full_name)
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000005204','aaaaaaaa-0000-4000-a000-000000005204','VEH-RECON-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('e0000000-0000-4000-e000-000000005201','aaaaaaaa-0000-4000-a000-000000005204','CARGA-RECON-OLD','in_progress'),
  ('e0000000-0000-4000-e000-000000005202','aaaaaaaa-0000-4000-a000-000000005204','CARGA-RECON-NEW','in_progress'),
  ('e0000000-0000-4000-e000-000000005203','aaaaaaaa-0000-4000-a000-000000005204','CARGA-RECON-TRANSIT','in_progress'),
  ('e0000000-0000-4000-e000-000000005204','aaaaaaaa-0000-4000-a000-000000005204','CARGA-RECON-RECEIVED','in_progress')
ON CONFLICT DO NOTHING;

-- Four routes, one per case the migration must distinguish. Inserted with
-- their terminal status directly: the status-sync trigger is AFTER UPDATE, so
-- an INSERT does not fire it and the fixtures stay exactly as written.
INSERT INTO public.pickup_routes
  (id, operator_id, code, driver_id, vehicle_id, status, started_at, in_transit_at, received_at)
VALUES
  -- (1) abandoned: in_progress, started before the '2026-08-01' cutoff
  ('50000000-0000-4000-5000-000000005201','aaaaaaaa-0000-4000-a000-000000005204','PR-RECON-OLD',
   'dddddddd-0000-4000-d000-000000005201','99999999-0000-4000-9000-000000005204',
   'in_progress','2026-07-30 09:00:00+00', NULL, NULL),
  -- (2) live: in_progress, started AFTER the cutoff — must survive untouched
  ('50000000-0000-4000-5000-000000005202','aaaaaaaa-0000-4000-a000-000000005204','PR-RECON-NEW',
   'dddddddd-0000-4000-d000-000000005202','99999999-0000-4000-9000-000000005204',
   'in_progress','2026-08-09 09:00:00+00', NULL, NULL),
  -- (3) in_transit with an OLD started_at — a receptionist can still finish it
  ('50000000-0000-4000-5000-000000005203','aaaaaaaa-0000-4000-a000-000000005204','PR-RECON-TRANSIT',
   'dddddddd-0000-4000-d000-000000005203','99999999-0000-4000-9000-000000005204',
   'in_transit','2026-07-28 09:00:00+00','2026-07-28 18:00:00+00', NULL),
  -- (4) received — terminal
  ('50000000-0000-4000-5000-000000005204','aaaaaaaa-0000-4000-a000-000000005204','PR-RECON-RECEIVED',
   'dddddddd-0000-4000-d000-000000005204','99999999-0000-4000-9000-000000005204',
   'received','2026-07-25 09:00:00+00','2026-07-25 18:00:00+00','2026-07-26 10:00:00+00');

UPDATE public.manifests SET pickup_route_id = '50000000-0000-4000-5000-000000005201'
 WHERE id = 'e0000000-0000-4000-e000-000000005201'
   AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
UPDATE public.manifests SET pickup_route_id = '50000000-0000-4000-5000-000000005202'
 WHERE id = 'e0000000-0000-4000-e000-000000005202'
   AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
UPDATE public.manifests
   SET pickup_route_id = '50000000-0000-4000-5000-000000005203',
       reception_status = 'awaiting_reception'
 WHERE id = 'e0000000-0000-4000-e000-000000005203'
   AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
UPDATE public.manifests
   SET pickup_route_id = '50000000-0000-4000-5000-000000005204',
       reception_status = 'received'
 WHERE id = 'e0000000-0000-4000-e000-000000005204'
   AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';

-- ---------------------------------------------------------------------------
-- Act — the same call the migration made, scoped to this operator
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INT;
BEGIN
  v_n := public.reconcile_abandoned_pickup_routes(
           '2026-08-01'::TIMESTAMPTZ,
           'aaaaaaaa-0000-4000-a000-000000005204'::UUID);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 route cancelled, got %', v_n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Assert (1) — the abandoned route was cancelled and its manifest detached
-- ---------------------------------------------------------------------------
DO $$
DECLARE r public.pickup_routes; m public.manifests;
BEGIN
  SELECT * INTO r FROM public.pickup_routes
   WHERE id = '50000000-0000-4000-5000-000000005201'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';

  IF r.status <> 'cancelled' THEN
    RAISE EXCEPTION 'abandoned route should be cancelled, is %', r.status;
  END IF;
  IF r.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'abandoned route should have cancelled_at set';
  END IF;
  IF r.cancellation_reason IS DISTINCT FROM 'ruta abandonada — migración spec-52' THEN
    RAISE EXCEPTION 'abandoned route cancellation_reason is %, expected the spec-52 marker',
      COALESCE(r.cancellation_reason, '<null>');
  END IF;

  SELECT * INTO m FROM public.manifests
   WHERE id = 'e0000000-0000-4000-e000-000000005201'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
  IF m.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'manifest of the abandoned route should be detached, still on %', m.pickup_route_id;
  END IF;
  IF m.reception_status IS NOT NULL THEN
    RAISE EXCEPTION 'manifest of the abandoned route should have reception_status cleared, is %', m.reception_status;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Assert (2) — a RECENT in_progress route is untouched
-- ---------------------------------------------------------------------------
DO $$
DECLARE r public.pickup_routes; m public.manifests;
BEGIN
  SELECT * INTO r FROM public.pickup_routes
   WHERE id = '50000000-0000-4000-5000-000000005202'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';

  IF r.status <> 'in_progress' THEN
    RAISE EXCEPTION 'recent route should stay in_progress, is %', r.status;
  END IF;
  IF r.cancelled_at IS NOT NULL OR r.cancellation_reason IS NOT NULL THEN
    RAISE EXCEPTION 'recent route should carry no cancellation metadata';
  END IF;

  SELECT * INTO m FROM public.manifests
   WHERE id = 'e0000000-0000-4000-e000-000000005202'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
  IF m.pickup_route_id IS DISTINCT FROM '50000000-0000-4000-5000-000000005202'::UUID THEN
    RAISE EXCEPTION 'recent route manifest should stay attached, is on %',
      COALESCE(m.pickup_route_id::TEXT, '<null>');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Assert (3) — an OLD in_transit route is untouched (receptionist finishes it)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r public.pickup_routes; m public.manifests;
BEGIN
  SELECT * INTO r FROM public.pickup_routes
   WHERE id = '50000000-0000-4000-5000-000000005203'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';

  IF r.status <> 'in_transit' THEN
    RAISE EXCEPTION 'old in_transit route should stay in_transit, is %', r.status;
  END IF;
  IF r.cancelled_at IS NOT NULL OR r.cancellation_reason IS NOT NULL THEN
    RAISE EXCEPTION 'in_transit route should carry no cancellation metadata';
  END IF;

  SELECT * INTO m FROM public.manifests
   WHERE id = 'e0000000-0000-4000-e000-000000005203'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
  IF m.pickup_route_id IS DISTINCT FROM '50000000-0000-4000-5000-000000005203'::UUID
     OR m.reception_status IS DISTINCT FROM 'awaiting_reception' THEN
    RAISE EXCEPTION 'in_transit route manifest should stay attached and awaiting_reception';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Assert (4) — a received route is untouched
-- ---------------------------------------------------------------------------
DO $$
DECLARE r public.pickup_routes;
BEGIN
  SELECT * INTO r FROM public.pickup_routes
   WHERE id = '50000000-0000-4000-5000-000000005204'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';

  IF r.status <> 'received' THEN
    RAISE EXCEPTION 'received route should stay received, is %', r.status;
  END IF;
  IF r.cancelled_at IS NOT NULL OR r.cancellation_reason IS NOT NULL THEN
    RAISE EXCEPTION 'received route should carry no cancellation metadata';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Assert (5) — idempotency: a second call changes nothing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n      INT;
  v_before TIMESTAMPTZ;
  v_after  TIMESTAMPTZ;
BEGIN
  SELECT cancelled_at INTO v_before FROM public.pickup_routes
   WHERE id = '50000000-0000-4000-5000-000000005201'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';

  v_n := public.reconcile_abandoned_pickup_routes(
           '2026-08-01'::TIMESTAMPTZ,
           'aaaaaaaa-0000-4000-a000-000000005204'::UUID);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 're-running reconciliation should cancel 0 routes, cancelled %', v_n;
  END IF;

  SELECT cancelled_at INTO v_after FROM public.pickup_routes
   WHERE id = '50000000-0000-4000-5000-000000005201'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000005204';
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 're-running reconciliation moved cancelled_at from % to %', v_before, v_after;
  END IF;
END $$;

ROLLBACK;
