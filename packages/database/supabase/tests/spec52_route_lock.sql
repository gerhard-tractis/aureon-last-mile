-- spec-52 Task 5 — pickup_scans route lock
--
-- Once a route has left the driver's hands (status <> 'in_progress') no more
-- pickup scans may be attached to its manifests: the reception batch's
-- expected_count is already frozen, so a late scan would silently create a
-- package the hub can never reconcile.
--
-- THE TRAP THIS FILE EXISTS TO GUARD:
-- most manifests are scanned BEFORE they are attached to any route —
-- usePickupScans.ts inserts a pickup_scans row on every single scan, and at
-- that moment manifests.pickup_route_id is NULL. A `status IS DISTINCT FROM
-- 'in_progress'` predicate evaluates TRUE for a NULL route and would block the
-- entire ordinary pickup flow. The rule is: NO ROUTE -> ALLOW.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000531','Spec52 Lock','spec52-lock')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000531',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver@spec52lock.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000531"}'::jsonb,
   '{"full_name":"Driver Lock"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES ('aaaaaaaa-0000-4000-a000-000000000531','aaaaaaaa-0000-4000-a000-000000000531',
        'driver@spec52lock.test','Driver Lock',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000531','aaaaaaaa-0000-4000-a000-000000000531','VEH-LOCK-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000531','aaaaaaaa-0000-4000-a000-000000000531',
        'ORD-LOCK-1','Cust','+56912345678','Addr 1','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('dddddddd-0000-4000-d000-000000000531','aaaaaaaa-0000-4000-a000-000000000531','cccccccc-0000-4000-c000-000000000531','PKG-LOCK-1','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000532','aaaaaaaa-0000-4000-a000-000000000531','cccccccc-0000-4000-c000-000000000531','PKG-LOCK-2','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000533','aaaaaaaa-0000-4000-a000-000000000531','cccccccc-0000-4000-c000-000000000531','PKG-LOCK-3','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

-- m-attached goes on the route; m-free never does (the common path).
INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('eeeeeeee-0000-4000-e000-000000000531','aaaaaaaa-0000-4000-a000-000000000531','CARGA-LOCK-1','in_progress'),
  ('eeeeeeee-0000-4000-e000-000000000532','aaaaaaaa-0000-4000-a000-000000000531','CARGA-LOCK-2','in_progress')
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('11111111-0000-4000-1000-000000000531','aaaaaaaa-0000-4000-a000-000000000531','PR-LOCK-1',
        'aaaaaaaa-0000-4000-a000-000000000531','99999999-0000-4000-9000-000000000531','in_progress');

UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000531'
 WHERE id = 'eeeeeeee-0000-4000-e000-000000000531';

SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000531","operator_id":"aaaaaaaa-0000-4000-a000-000000000531","role":"authenticated"}',
  true);

-- ---------------------------------------------------------------------------
-- CASE 1 — allowed while the route is in_progress
-- ---------------------------------------------------------------------------
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000531','eeeeeeee-0000-4000-e000-000000000531',
        'dddddddd-0000-4000-d000-000000000531','PKG-LOCK-1','verified', NOW());

-- ---------------------------------------------------------------------------
-- CASE 2 — THE COMMON PATH: manifest with no pickup_route_id is ALWAYS allowed
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT pickup_route_id FROM public.manifests
       WHERE id = 'eeeeeeee-0000-4000-e000-000000000532') IS NOT NULL THEN
    RAISE EXCEPTION 'fixture broken: the unattached manifest must have a NULL pickup_route_id';
  END IF;
END $$;

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000531','eeeeeeee-0000-4000-e000-000000000532',
        'dddddddd-0000-4000-d000-000000000532','PKG-LOCK-2','verified', NOW());

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.pickup_scans
       WHERE manifest_id = 'eeeeeeee-0000-4000-e000-000000000532') <> 1 THEN
    RAISE EXCEPTION 'a scan on an unattached manifest must be allowed — the ordinary pickup flow depends on it';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — rejected with 55000 once the route is in_transit
-- ---------------------------------------------------------------------------
SELECT public.open_route_reception('11111111-0000-4000-1000-000000000531'::UUID);

DO $$
DECLARE v_state TEXT := NULL;
BEGIN
  BEGIN
    INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000531','eeeeeeee-0000-4000-e000-000000000531',
            'dddddddd-0000-4000-d000-000000000533','PKG-LOCK-3','verified', NOW());
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'pickup_scans insert must be rejected once the route is in_transit';
  END IF;
  IF v_state <> '55000' THEN
    RAISE EXCEPTION 'expected SQLSTATE 55000 from the route lock, got %', v_state;
  END IF;
END $$;

-- ...and the unattached manifest is STILL scannable while that route is locked.
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000531','eeeeeeee-0000-4000-e000-000000000532',
        'dddddddd-0000-4000-d000-000000000533','PKG-LOCK-3','verified', NOW());

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
