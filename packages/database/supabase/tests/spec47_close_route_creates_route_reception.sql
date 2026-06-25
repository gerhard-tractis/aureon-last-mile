-- spec-47 — closing a route fires trigger that creates route_receptions
-- with the correct expected_count (sum of verified pickup_scans across linked manifests).

BEGIN;

-- ─── Fixture ───────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000347','Spec47 Close','spec47-close')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000347',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-close@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000347','aaaaaaaa-0000-4000-a000-000000000347','driver-close@spec47.test','Driver Close',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000347','aaaaaaaa-0000-4000-a000-000000000347',
        'ORD-CLOSE-1','Cust','+56912345678','Addr 1','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('dddddddd-0000-4000-d000-000000000147','aaaaaaaa-0000-4000-a000-000000000347','cccccccc-0000-4000-c000-000000000347','PKG-CLOSE-1','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000247','aaaaaaaa-0000-4000-a000-000000000347','cccccccc-0000-4000-c000-000000000347','PKG-CLOSE-2','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES ('eeeeeeee-0000-4000-e000-000000000347','aaaaaaaa-0000-4000-a000-000000000347','CARGA-CLOSE-1','in_progress')
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, status)
VALUES ('11111111-0000-4000-1000-000000000347','aaaaaaaa-0000-4000-a000-000000000347','PR-CLOSE-1',
        'aaaaaaaa-0000-4000-a000-000000000347','in_progress');

UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000347'
 WHERE id = 'eeeeeeee-0000-4000-e000-000000000347';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000347','eeeeeeee-0000-4000-e000-000000000347','dddddddd-0000-4000-d000-000000000147','PKG-CLOSE-1','verified', NOW()),
  ('aaaaaaaa-0000-4000-a000-000000000347','eeeeeeee-0000-4000-e000-000000000347','dddddddd-0000-4000-d000-000000000247','PKG-CLOSE-2','verified', NOW());

-- ─── Flip route to in_transit; trigger should create route_receptions ──────
UPDATE public.pickup_routes
   SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '11111111-0000-4000-1000-000000000347';

DO $$
DECLARE rr_count INT; expected INT;
BEGIN
  SELECT COUNT(*), MAX(expected_count) INTO rr_count, expected
    FROM public.route_receptions
   WHERE pickup_route_id = '11111111-0000-4000-1000-000000000347';

  IF rr_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 route_receptions row after route close, got %', rr_count;
  END IF;
  IF expected <> 2 THEN
    RAISE EXCEPTION 'expected_count should be 2 (verified scans), got %', expected;
  END IF;
END $$;

-- And linked manifest should be flipped to awaiting_reception
DO $$
DECLARE rs reception_status_enum;
BEGIN
  SELECT reception_status INTO rs FROM public.manifests
   WHERE id = 'eeeeeeee-0000-4000-e000-000000000347';
  IF rs IS DISTINCT FROM 'awaiting_reception' THEN
    RAISE EXCEPTION 'manifest reception_status should be awaiting_reception, got %', rs;
  END IF;
END $$;

ROLLBACK;
