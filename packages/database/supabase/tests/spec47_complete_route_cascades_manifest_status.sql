-- spec-47 — completing a route_reception cascades manifest status to 'received'
-- and flips pickup_routes.status to 'received'.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000647','Spec47 Comp','spec47-comp')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000647',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-comp@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000647','aaaaaaaa-0000-4000-a000-000000000647','driver-comp@spec47.test','Driver Comp',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000647','aaaaaaaa-0000-4000-a000-000000000647',
        'ORD-COMP-1','Cust','+56912345678','Addr','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES ('dddddddd-0000-4000-d000-000000000647','aaaaaaaa-0000-4000-a000-000000000647',
        'cccccccc-0000-4000-c000-000000000647','PKG-COMP-1','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('eeeeeeee-0000-4000-e000-000000000647','aaaaaaaa-0000-4000-a000-000000000647','CARGA-COMP-A','completed'),
  ('ffffffff-0000-4000-f000-000000000647','aaaaaaaa-0000-4000-a000-000000000647','CARGA-COMP-B','completed')
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, status)
VALUES ('44444444-0000-4000-4000-000000000647','aaaaaaaa-0000-4000-a000-000000000647','PR-COMP-1',
        'aaaaaaaa-0000-4000-a000-000000000647','in_progress');

UPDATE public.manifests SET pickup_route_id = '44444444-0000-4000-4000-000000000647'
 WHERE id IN ('eeeeeeee-0000-4000-e000-000000000647','ffffffff-0000-4000-f000-000000000647');

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000647','eeeeeeee-0000-4000-e000-000000000647',
        'dddddddd-0000-4000-d000-000000000647','PKG-COMP-1','verified', NOW());

UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '44444444-0000-4000-4000-000000000647';

-- Flip route_receptions to completed → trigger cascades
DO $$
DECLARE rr_id UUID;
BEGIN
  SELECT id INTO rr_id FROM public.route_receptions
   WHERE pickup_route_id = '44444444-0000-4000-4000-000000000647';

  UPDATE public.route_receptions
     SET status = 'completed', completed_at = NOW()
   WHERE id = rr_id;
END $$;

-- Verify cascades
DO $$
DECLARE
  pickup_status pickup_route_status_enum;
  bad_manifests INT;
BEGIN
  SELECT status INTO pickup_status FROM public.pickup_routes
   WHERE id = '44444444-0000-4000-4000-000000000647';
  IF pickup_status IS DISTINCT FROM 'received' THEN
    RAISE EXCEPTION 'pickup_routes.status should be received, got %', pickup_status;
  END IF;

  SELECT COUNT(*) INTO bad_manifests
    FROM public.manifests
   WHERE pickup_route_id = '44444444-0000-4000-4000-000000000647'
     AND (reception_status IS DISTINCT FROM 'received');
  IF bad_manifests <> 0 THEN
    RAISE EXCEPTION '% manifests not flipped to received', bad_manifests;
  END IF;
END $$;

ROLLBACK;
