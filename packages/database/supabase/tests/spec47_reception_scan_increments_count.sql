-- spec-47 — reception_scan trigger increments route_receptions.received_count
-- and promotes status from pending → in_progress.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000547','Spec47 Inc','spec47-inc')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000547',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-inc@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000547','aaaaaaaa-0000-4000-a000-000000000547','driver-inc@spec47.test','Driver Inc',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000547','aaaaaaaa-0000-4000-a000-000000000547',
        'ORD-INC-1','Cust','+56912345678','Addr','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES ('dddddddd-0000-4000-d000-000000000547','aaaaaaaa-0000-4000-a000-000000000547',
        'cccccccc-0000-4000-c000-000000000547','PKG-INC-1','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES ('eeeeeeee-0000-4000-e000-000000000547','aaaaaaaa-0000-4000-a000-000000000547','CARGA-INC-1','completed')
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, status)
VALUES ('33333333-0000-4000-3000-000000000547','aaaaaaaa-0000-4000-a000-000000000547','PR-INC-1',
        'aaaaaaaa-0000-4000-a000-000000000547','in_progress');

UPDATE public.manifests SET pickup_route_id = '33333333-0000-4000-3000-000000000547'
 WHERE id = 'eeeeeeee-0000-4000-e000-000000000547';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000547','eeeeeeee-0000-4000-e000-000000000547',
        'dddddddd-0000-4000-d000-000000000547','PKG-INC-1','verified', NOW());

-- Trigger route_receptions creation
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '33333333-0000-4000-3000-000000000547';

-- Capture route_reception id
DO $$
DECLARE
  rr_id UUID;
  rr_status hub_reception_status_enum;
  rr_count INT;
BEGIN
  SELECT id INTO rr_id FROM public.route_receptions
   WHERE pickup_route_id = '33333333-0000-4000-3000-000000000547';
  IF rr_id IS NULL THEN
    RAISE EXCEPTION 'route_receptions row missing after route close';
  END IF;

  -- Insert a reception scan
  INSERT INTO public.reception_scans
    (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
  VALUES
    (rr_id, 'dddddddd-0000-4000-d000-000000000547',
     'aaaaaaaa-0000-4000-a000-000000000547', 'PKG-INC-1', 'received', NOW());

  SELECT status, received_count INTO rr_status, rr_count
    FROM public.route_receptions WHERE id = rr_id;
  IF rr_count <> 1 THEN
    RAISE EXCEPTION 'received_count should be 1 after one received scan, got %', rr_count;
  END IF;
  IF rr_status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'status should be in_progress after first received scan, got %', rr_status;
  END IF;
END $$;

ROLLBACK;
