-- spec-52 Task 5 — reopen_pickup_route()
--
-- The undo for a mistaken QR scan. It rewinds the route to in_progress, clears
-- in_transit_at, clears the manifests' reception_status, and SOFT-DELETES the
-- batch (CLAUDE.md is soft-deletes-only; uniq_route_receptions_pickup_route is
-- partial on deleted_at IS NULL, so the row can lie there forever and a later
-- rescan still inserts cleanly).
--
-- Two guards, in this order:
--   1. any reception_scans on the batch => refuse. Unloading has started;
--      finishing and recording a discrepancy is the correct move, not a rewind.
--   2. returning to in_progress re-enters uniq_pickup_routes_one_active_per_driver.
--      If the driver already started a replacement route — which is exactly
--      what a locked-out driver does — a raw revert raises an opaque 23505.
--      Pre-check it and raise a named Spanish error instead.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures — three routes, three drivers (one in_progress route per driver)
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000541','Spec52 Reopen','spec52-reopen')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000541','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','d1@spec52reopen.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000541"}'::jsonb,
   '{"full_name":"Driver Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000542','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','d2@spec52reopen.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000541"}'::jsonb,
   '{"full_name":"Driver Dos"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000543','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','d3@spec52reopen.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000541"}'::jsonb,
   '{"full_name":"Driver Tres"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000541','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','recepcion@spec52reopen.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000541"}'::jsonb,
   '{"full_name":"Recepcionista"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000541','aaaaaaaa-0000-4000-a000-000000000541','d1@spec52reopen.test','Driver Uno',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000542','aaaaaaaa-0000-4000-a000-000000000541','d2@spec52reopen.test','Driver Dos',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000543','aaaaaaaa-0000-4000-a000-000000000541','d3@spec52reopen.test','Driver Tres',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000541','aaaaaaaa-0000-4000-a000-000000000541','recepcion@spec52reopen.test','Recepcionista',ARRAY['reception'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000541','aaaaaaaa-0000-4000-a000-000000000541','VEH-REOPEN-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000541','aaaaaaaa-0000-4000-a000-000000000541',
        'ORD-REOPEN-1','Cust','+56912345678','Addr 1','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('dddddddd-0000-4000-d000-000000000541','aaaaaaaa-0000-4000-a000-000000000541','cccccccc-0000-4000-c000-000000000541','PKG-REOPEN-1','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000542','aaaaaaaa-0000-4000-a000-000000000541','cccccccc-0000-4000-c000-000000000541','PKG-REOPEN-2','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000543','aaaaaaaa-0000-4000-a000-000000000541','cccccccc-0000-4000-c000-000000000541','PKG-REOPEN-3','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('eeeeeeee-0000-4000-e000-000000000541','aaaaaaaa-0000-4000-a000-000000000541','CARGA-REOPEN-1','in_progress'),
  ('eeeeeeee-0000-4000-e000-000000000542','aaaaaaaa-0000-4000-a000-000000000541','CARGA-REOPEN-2','in_progress'),
  ('eeeeeeee-0000-4000-e000-000000000543','aaaaaaaa-0000-4000-a000-000000000541','CARGA-REOPEN-3','in_progress')
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES
  ('11111111-0000-4000-1000-000000000541','aaaaaaaa-0000-4000-a000-000000000541','PR-REOPEN-1',
   'aaaaaaaa-0000-4000-a000-000000000541','99999999-0000-4000-9000-000000000541','in_progress'),
  ('11111111-0000-4000-1000-000000000542','aaaaaaaa-0000-4000-a000-000000000541','PR-REOPEN-2',
   'aaaaaaaa-0000-4000-a000-000000000542','99999999-0000-4000-9000-000000000541','in_progress'),
  ('11111111-0000-4000-1000-000000000543','aaaaaaaa-0000-4000-a000-000000000541','PR-REOPEN-3',
   'aaaaaaaa-0000-4000-a000-000000000543','99999999-0000-4000-9000-000000000541','in_progress');

UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000541' WHERE id = 'eeeeeeee-0000-4000-e000-000000000541';
UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000542' WHERE id = 'eeeeeeee-0000-4000-e000-000000000542';
UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000543' WHERE id = 'eeeeeeee-0000-4000-e000-000000000543';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000541','eeeeeeee-0000-4000-e000-000000000541','dddddddd-0000-4000-d000-000000000541','PKG-REOPEN-1','verified', NOW()),
  ('aaaaaaaa-0000-4000-a000-000000000541','eeeeeeee-0000-4000-e000-000000000542','dddddddd-0000-4000-d000-000000000542','PKG-REOPEN-2','verified', NOW()),
  ('aaaaaaaa-0000-4000-a000-000000000541','eeeeeeee-0000-4000-e000-000000000543','dddddddd-0000-4000-d000-000000000543','PKG-REOPEN-3','verified', NOW());

SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-b000-000000000541","operator_id":"aaaaaaaa-0000-4000-a000-000000000541","role":"authenticated"}',
  true);

-- Open all three batches through the real RPC.
SELECT public.open_route_reception('11111111-0000-4000-1000-000000000541'::UUID);
SELECT public.open_route_reception('11111111-0000-4000-1000-000000000542'::UUID);
SELECT public.open_route_reception('11111111-0000-4000-1000-000000000543'::UUID);

-- ---------------------------------------------------------------------------
-- CASE 1 — empty batch reverts cleanly, batch is SOFT-deleted
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_batch_id UUID;
  v_route    public.pickup_routes;
  v_del      TIMESTAMPTZ;
  v_rows     INT;
BEGIN
  SELECT id INTO v_batch_id FROM public.route_receptions
   WHERE pickup_route_id = '11111111-0000-4000-1000-000000000541' AND deleted_at IS NULL;

  PERFORM public.reopen_pickup_route('11111111-0000-4000-1000-000000000541'::UUID);

  SELECT * INTO v_route FROM public.pickup_routes WHERE id = '11111111-0000-4000-1000-000000000541';
  IF v_route.status <> 'in_progress' THEN
    RAISE EXCEPTION 'route should be back to in_progress, got %', v_route.status;
  END IF;
  IF v_route.in_transit_at IS NOT NULL THEN
    RAISE EXCEPTION 'in_transit_at should be cleared, got %', v_route.in_transit_at;
  END IF;

  IF (SELECT reception_status FROM public.manifests
       WHERE id = 'eeeeeeee-0000-4000-e000-000000000541') IS NOT NULL THEN
    RAISE EXCEPTION 'manifest reception_status should be back to NULL';
  END IF;

  -- SOFT delete: the row must still be there, with deleted_at set.
  SELECT COUNT(*), MAX(deleted_at) INTO v_rows, v_del
    FROM public.route_receptions WHERE id = v_batch_id;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'the batch row was hard-deleted — CLAUDE.md is soft-deletes-only';
  END IF;
  IF v_del IS NULL THEN
    RAISE EXCEPTION 'the batch should be soft-deleted (deleted_at set)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — after a reopen, a fresh scan opens a NEW batch
--          (proves the partial unique index still lets the insert through)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_new public.route_receptions;
  v_live INT;
BEGIN
  v_new := public.open_route_reception('11111111-0000-4000-1000-000000000541'::UUID);
  IF v_new.id IS NULL THEN
    RAISE EXCEPTION 'reopen-then-rescan produced no batch';
  END IF;
  IF v_new.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reopen-then-rescan returned the DEAD batch — the idempotency lookup is missing its deleted_at IS NULL filter';
  END IF;

  SELECT COUNT(*) INTO v_live FROM public.route_receptions
   WHERE pickup_route_id = '11111111-0000-4000-1000-000000000541' AND deleted_at IS NULL;
  IF v_live <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 live batch after reopen+rescan, got %', v_live;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — refuses once any reception_scans exist
-- ---------------------------------------------------------------------------
INSERT INTO public.reception_scans (reception_id, operator_id, barcode, scan_result, scanned_at)
SELECT id, 'aaaaaaaa-0000-4000-a000-000000000541', 'PKG-UNKNOWN', 'not_found', NOW()
  FROM public.route_receptions
 WHERE pickup_route_id = '11111111-0000-4000-1000-000000000542' AND deleted_at IS NULL;

DO $$
DECLARE v_msg TEXT := NULL;
BEGIN
  BEGIN
    PERFORM public.reopen_pickup_route('11111111-0000-4000-1000-000000000542'::UUID);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'reopen must refuse a batch that already has reception_scans';
  END IF;
  IF (SELECT status FROM public.pickup_routes WHERE id = '11111111-0000-4000-1000-000000000542') <> 'in_transit' THEN
    RAISE EXCEPTION 'the refused reopen must have left the route in_transit';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — the driver already started a replacement route: NAMED error, not 23505
-- ---------------------------------------------------------------------------
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('11111111-0000-4000-1000-000000000544','aaaaaaaa-0000-4000-a000-000000000541','PR-REOPEN-4',
        'aaaaaaaa-0000-4000-a000-000000000543','99999999-0000-4000-9000-000000000541','in_progress');

DO $$
DECLARE v_state TEXT := NULL; v_msg TEXT := NULL;
BEGIN
  BEGIN
    PERFORM public.reopen_pickup_route('11111111-0000-4000-1000-000000000543'::UUID);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'reopen must refuse when the driver already has a replacement active route';
  END IF;
  IF v_state = '23505' THEN
    RAISE EXCEPTION 'reopen leaked a bare unique_violation (23505): %', v_msg;
  END IF;
  IF v_msg NOT LIKE '%ruta de retiro activa%' THEN
    RAISE EXCEPTION 'expected the named Spanish active-route error, got %', v_msg;
  END IF;
  IF (SELECT status FROM public.pickup_routes WHERE id = '11111111-0000-4000-1000-000000000543') <> 'in_transit' THEN
    RAISE EXCEPTION 'the refused reopen must have left the route in_transit';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — a driver may not reopen; reception/operations may
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000542","operator_id":"aaaaaaaa-0000-4000-a000-000000000541","role":"authenticated"}',
  true);

DO $$
DECLARE v_state TEXT := NULL;
BEGIN
  BEGIN
    PERFORM public.reopen_pickup_route('11111111-0000-4000-1000-000000000542'::UUID);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'a pickup-only user must be refused with 42501, got %', COALESCE(v_state,'no error');
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
