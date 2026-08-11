-- spec-52 Task 2 — package state engine
--
-- Covers the missing first link of the scan pipeline: a 'verified' pickup scan
-- must move its package ingresado -> verificado. Without it the whole chain is
-- dead (reception-scan validation rejects any package that is not 'verificado',
-- so the existing en_bodega trigger never fires and orders never roll up).
--
-- NOTE FOR FUTURE READERS: cases 2, 3 and 4 pass VACUOUSLY against the code as
-- it stood before this spec — nothing moved a package on pickup scan at all, so
-- "it did not move" was trivially true. They only become meaningful once
-- trg_pickup_scan_advance_status exists. They are guard-rails on the guard, not
-- pre-existing coverage. Mutation-test them, don't trust them.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures (modelled on spec47_reception_scan_increments_count.sql)
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000552','Spec52 Inc','spec52-state')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000552',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver@spec52state.test', crypt('x', gen_salt('bf')), NOW(),
   -- operator_id belongs in raw_APP_meta_data: public.handle_new_user() reads
   -- NEW.raw_app_meta_data->>'operator_id' and ignores raw_user_meta_data
   -- except for full_name.
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000552"}'::jsonb,
   '{"full_name":"Driver 52"}'::jsonb,
   NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created this row.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES ('aaaaaaaa-0000-4000-a000-000000000552',
        'aaaaaaaa-0000-4000-a000-000000000552',
        'driver@spec52state.test','Driver 52',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- Order A holds the unit-test packages; order B is the integration case.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('cccccccc-0000-4000-c000-00000000055a','aaaaaaaa-0000-4000-a000-000000000552',
   'ORD-52A','Cust A','+56912345678','Addr A','Santiago', CURRENT_DATE, '{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-00000000055b','aaaaaaaa-0000-4000-a000-000000000552',
   'ORD-52B','Cust B','+56912345679','Addr B','Santiago', CURRENT_DATE, '{}'::jsonb,'MANUAL', NOW())
ON CONFLICT DO NOTHING;

-- p1  ingresado   -> expected verificado
-- p2  en_ruta     -> must not regress
-- p3  cancelado   } the pipeline_position()==0 trap: a naive rank comparison
-- p4  extraviado  } would read 2 > 0 and resurrect every one of these
-- p5  devuelto    }
-- p6  dañado      }
-- p7  retorno_hub }
-- p8  ingresado   -> scanned 'duplicate', must not move
-- p9  ingresado   -> scanned 'not_found', must not move
INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('dddddddd-0000-4000-d000-000000000001','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('dddddddd-0000-4000-d000-000000000002','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-2','[]'::jsonb,'{}'::jsonb,'en_ruta'),
  ('dddddddd-0000-4000-d000-000000000003','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-3','[]'::jsonb,'{}'::jsonb,'cancelado'),
  ('dddddddd-0000-4000-d000-000000000004','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-4','[]'::jsonb,'{}'::jsonb,'extraviado'),
  ('dddddddd-0000-4000-d000-000000000005','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-5','[]'::jsonb,'{}'::jsonb,'devuelto'),
  ('dddddddd-0000-4000-d000-000000000006','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-6','[]'::jsonb,'{}'::jsonb,'dañado'),
  ('dddddddd-0000-4000-d000-000000000007','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-7','[]'::jsonb,'{}'::jsonb,'retorno_hub'),
  ('dddddddd-0000-4000-d000-000000000008','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-8','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('dddddddd-0000-4000-d000-000000000009','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055a','PKG-52-9','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('dddddddd-0000-4000-d000-00000000000b','aaaaaaaa-0000-4000-a000-000000000552','cccccccc-0000-4000-c000-00000000055b','PKG-52-B','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT DO NOTHING;

-- Clear status_updated_at so case 1 can prove the trigger wrote it.
UPDATE public.packages SET status_updated_at = NULL
 WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES ('eeeeeeee-0000-4000-e000-000000000552','aaaaaaaa-0000-4000-a000-000000000552','CARGA-52-1','completed')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Case 1 — verified pickup scan: ingresado -> verificado, stamps status_updated_at
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_status TEXT; v_stamp TIMESTAMPTZ;
BEGIN
  INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
  VALUES ('aaaaaaaa-0000-4000-a000-000000000552','eeeeeeee-0000-4000-e000-000000000552',
          'dddddddd-0000-4000-d000-000000000001','PKG-52-1','verified', NOW());

  SELECT status::text, status_updated_at INTO v_status, v_stamp
    FROM public.packages WHERE id = 'dddddddd-0000-4000-d000-000000000001'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';

  IF v_status IS DISTINCT FROM 'verificado' THEN
    RAISE EXCEPTION 'case 1: expected verificado after verified pickup scan, got %', v_status;
  END IF;
  IF v_stamp IS NULL THEN
    RAISE EXCEPTION 'case 1: status_updated_at was not stamped by the pickup trigger';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Cases 2-4 — forward-only guard. Any status whose pipeline_position() is >= 2,
-- and every terminal status (all of which rank 0), must be left untouched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r        RECORD;
  v_status TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('dddddddd-0000-4000-d000-000000000002'::uuid, 'PKG-52-2', 'en_ruta'),      -- case 2
      ('dddddddd-0000-4000-d000-000000000003'::uuid, 'PKG-52-3', 'cancelado'),    -- case 3
      ('dddddddd-0000-4000-d000-000000000004'::uuid, 'PKG-52-4', 'extraviado'),   -- case 4
      ('dddddddd-0000-4000-d000-000000000005'::uuid, 'PKG-52-5', 'devuelto'),
      ('dddddddd-0000-4000-d000-000000000006'::uuid, 'PKG-52-6', 'dañado'),
      ('dddddddd-0000-4000-d000-000000000007'::uuid, 'PKG-52-7', 'retorno_hub')
    ) AS t(pkg_id, barcode, expected)
  LOOP
    INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000552','eeeeeeee-0000-4000-e000-000000000552',
            r.pkg_id, r.barcode, 'verified', NOW());

    SELECT status::text INTO v_status
      FROM public.packages WHERE id = r.pkg_id
       AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';

    IF v_status IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'guard: package at % was moved to % by a pickup scan', r.expected, v_status;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Case 5 — non-verified scan results never advance a package
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_status TEXT;
BEGIN
  INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
  VALUES
    ('aaaaaaaa-0000-4000-a000-000000000552','eeeeeeee-0000-4000-e000-000000000552',
     'dddddddd-0000-4000-d000-000000000008','PKG-52-8','duplicate', NOW()),
    ('aaaaaaaa-0000-4000-a000-000000000552','eeeeeeee-0000-4000-e000-000000000552',
     'dddddddd-0000-4000-d000-000000000009','PKG-52-9','not_found', NOW()),
    -- the realistic not_found shape: no package at all. Must not raise.
    ('aaaaaaaa-0000-4000-a000-000000000552','eeeeeeee-0000-4000-e000-000000000552',
     NULL,'PKG-52-UNKNOWN','not_found', NOW());

  SELECT string_agg(status::text, ',' ORDER BY label) INTO v_status
    FROM public.packages
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000552'
     AND id IN ('dddddddd-0000-4000-d000-000000000008','dddddddd-0000-4000-d000-000000000009');

  IF v_status IS DISTINCT FROM 'ingresado,ingresado' THEN
    RAISE EXCEPTION 'case 5: duplicate/not_found scans changed status, got %', v_status;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Case 6 — INTEGRATION: the whole point. pickup scan -> verificado ->
-- reception scan -> en_bodega -> the pre-existing trg_recalculate_order_status
-- rolls orders.status up. Proves the chain is unblocked end to end.
-- ---------------------------------------------------------------------------
INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000552','aaaaaaaa-0000-4000-a000-000000000552','VEH-52-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('33333333-0000-4000-3000-000000000552','aaaaaaaa-0000-4000-a000-000000000552','PR-52-1',
        'aaaaaaaa-0000-4000-a000-000000000552','99999999-0000-4000-9000-000000000552','in_progress');

INSERT INTO public.manifests (id, operator_id, external_load_id, status, pickup_route_id)
VALUES ('eeeeeeee-0000-4000-e000-00000000055b','aaaaaaaa-0000-4000-a000-000000000552','CARGA-52-B','completed',
        '33333333-0000-4000-3000-000000000552')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_pkg   TEXT;
  v_order TEXT;
  rr_id   UUID;
BEGIN
  -- Baseline: the order must not already be at en_bodega, or case 6 proves nothing.
  SELECT status::text INTO v_order FROM public.orders
   WHERE id = 'cccccccc-0000-4000-c000-00000000055b'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';
  IF v_order = 'en_bodega' THEN
    RAISE EXCEPTION 'case 6: order was already en_bodega before the scans ran';
  END IF;

  -- Link 1: pickup scan -> verificado
  INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
  VALUES ('aaaaaaaa-0000-4000-a000-000000000552','eeeeeeee-0000-4000-e000-00000000055b',
          'dddddddd-0000-4000-d000-00000000000b','PKG-52-B','verified', NOW());

  SELECT status::text INTO v_pkg FROM public.packages
   WHERE id = 'dddddddd-0000-4000-d000-00000000000b'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';
  IF v_pkg IS DISTINCT FROM 'verificado' THEN
    RAISE EXCEPTION 'case 6 link 1: package is % not verificado', v_pkg;
  END IF;

  SELECT status::text INTO v_order FROM public.orders
   WHERE id = 'cccccccc-0000-4000-c000-00000000055b'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';
  IF v_order IS DISTINCT FROM 'verificado' THEN
    RAISE EXCEPTION 'case 6 link 1: order rolled up to % not verificado', v_order;
  END IF;

  -- Close the route so route_receptions exists (spec-47 behaviour).
  UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
   WHERE id = '33333333-0000-4000-3000-000000000552'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';

  SELECT id INTO rr_id FROM public.route_receptions
   WHERE pickup_route_id = '33333333-0000-4000-3000-000000000552'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';
  IF rr_id IS NULL THEN
    RAISE EXCEPTION 'case 6: route_receptions row missing after route close';
  END IF;

  -- Link 2: reception scan -> en_bodega (pre-existing trigger, now reachable)
  INSERT INTO public.reception_scans (reception_id, package_id, operator_id, barcode, scan_result, scanned_at)
  VALUES (rr_id, 'dddddddd-0000-4000-d000-00000000000b',
          'aaaaaaaa-0000-4000-a000-000000000552', 'PKG-52-B', 'received', NOW());

  SELECT status::text INTO v_pkg FROM public.packages
   WHERE id = 'dddddddd-0000-4000-d000-00000000000b'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';
  IF v_pkg IS DISTINCT FROM 'en_bodega' THEN
    RAISE EXCEPTION 'case 6 link 2: package is % not en_bodega', v_pkg;
  END IF;

  -- Link 3: order roll-up (untouched by this task — asserted, not rebuilt)
  SELECT status::text INTO v_order FROM public.orders
   WHERE id = 'cccccccc-0000-4000-c000-00000000055b'
     AND operator_id = 'aaaaaaaa-0000-4000-a000-000000000552';
  IF v_order IS DISTINCT FROM 'en_bodega' THEN
    RAISE EXCEPTION 'case 6 link 3: order is % not en_bodega — roll-up did not fire', v_order;
  END IF;
END $$;

ROLLBACK;
