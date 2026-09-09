-- pgTAP: spec-86 fase 1 — complete_route_reception records discrepancies via
-- record_discrepancies (spec-85 fase 2), on close, in the same transaction,
-- operation_type='reception'.
--
-- Fixture: one operator, one driver, one pickup_route (PR-86A) with two
-- manifests (CARGA-86A-1, CARGA-86A-2):
--   CTN86A-1 — verified at pickup, received at reception  -> not missing
--   CTN86A-2 — verified at pickup, NEVER received          -> missing, WITH
--              a reason the client sends in p_missing_reasons
--   CTN86A-3 — verified at pickup, its only 'received'      -> missing, NULL
--              reception_scan is soft-deleted, NO reason       note (respaldo
--              sent for it                                     automático;
--              mutation guard for `rs.deleted_at IS NULL`)
--   CTN86A-4 — verified at pickup, its PACKAGE ITSELF is    -> NOT missing at
--              soft-deleted                                    all
--              (mutation guard: sin `p.deleted_at IS NULL` un bulto borrado
--              contaría como faltante — choca de frente con el no-negociable
--              de soft deletes del repo)
-- A second pickup_route (PR-86B), fully received, 0 missing, proves the
-- empty-p_items path (spec-85's M5) does not fail the close, and that
-- discrepancies stay scoped to the route_reception that generated them, not
-- the operator at large.
BEGIN;
SELECT plan(12);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('00000000-0000-4000-8000-0000000086a0', 'Spec86a Op A', 'spec86a-op-a'),
  ('00000000-0000-4000-8000-0000000086b0', 'Spec86a Op Z (other tenant)', 'spec86a-op-z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-0000000086a1',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-86a@spec86.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000086a0"}'::jsonb,
   '{"full_name":"Driver 86A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-0000000086b9',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-86z@spec86.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000086b0"}'::jsonb,
   '{"full_name":"Driver 86Z"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086a0','driver-86a@spec86.test','Driver 86A',ARRAY['pickup']),
  ('00000000-0000-4000-8000-0000000086b9','00000000-0000-4000-8000-0000000086b0','driver-86z@spec86.test','Driver 86Z',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES
  ('00000000-0000-4000-8000-0000000086b1','00000000-0000-4000-8000-0000000086a0','VEH-86A-1', true),
  ('00000000-0000-4000-8000-0000000086b2','00000000-0000-4000-8000-0000000086a0','VEH-86A-2', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-0000000086c0','00000000-0000-4000-8000-0000000086a0',
   'ORD-86A-1','Cliente 86A','+56911111111','Calle 86A','Santiago', CURRENT_DATE,
   'CARGA-86A-1','Retailer 86A','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000086c1','00000000-0000-4000-8000-0000000086a0',
   'ORD-86A-2','Cliente 86A','+56911111111','Calle 86A','Santiago', CURRENT_DATE,
   'CARGA-86A-2','Retailer 86A','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086a0',
   '00000000-0000-4000-8000-0000000086c0','CTN86A-1','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d2','00000000-0000-4000-8000-0000000086a0',
   '00000000-0000-4000-8000-0000000086c0','CTN86A-2','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d3','00000000-0000-4000-8000-0000000086a0',
   '00000000-0000-4000-8000-0000000086c0','CTN86A-3','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d4','00000000-0000-4000-8000-0000000086a0',
   '00000000-0000-4000-8000-0000000086c0','CTN86A-4','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d5','00000000-0000-4000-8000-0000000086a0',
   '00000000-0000-4000-8000-0000000086c1','CTN86A-5','[]'::jsonb,'{}'::jsonb,'verificado')
ON CONFLICT (id) DO NOTHING;

-- CTN86A-4: the package itself is soft-deleted. Mutation guard for
-- `p.deleted_at IS NULL` in the p_items query.
UPDATE public.packages
   SET deleted_at = NOW()
 WHERE id = '00000000-0000-4000-8000-0000000086d4';

-- Two manifests, both attached to the SAME pickup_route (consolidated
-- reception is a per-ROUTE session, spec-47/spec-52). NOT inserted by hand:
-- 20260814000001's trg_ensure_manifest_for_order already created one manifest
-- row per external_load_id the moment its order was inserted above (same
-- fixture pattern as spec80_fase2_close_manifest_discrepancies.test.sql) --
-- an explicit INSERT here would collide on unique_manifest_per_operator.
UPDATE public.manifests
   SET status = 'completed', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-0000000086a0'
   AND external_load_id IN ('CARGA-86A-1', 'CARGA-86A-2');

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('00000000-0000-4000-8000-0000000086f1','00000000-0000-4000-8000-0000000086a0','PR-86A-1','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086b1','in_progress')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests
   SET pickup_route_id = '00000000-0000-4000-8000-0000000086f1'
 WHERE operator_id = '00000000-0000-4000-8000-0000000086a0'
   AND external_load_id = 'CARGA-86A-1';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('00000000-0000-4000-8000-0000000086a0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-1'),
   '00000000-0000-4000-8000-0000000086d1','CTN86A-1','verified', NOW()),
  ('00000000-0000-4000-8000-0000000086a0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-1'),
   '00000000-0000-4000-8000-0000000086d2','CTN86A-2','verified', NOW()),
  ('00000000-0000-4000-8000-0000000086a0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-1'),
   '00000000-0000-4000-8000-0000000086d3','CTN86A-3','verified', NOW()),
  ('00000000-0000-4000-8000-0000000086a0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-1'),
   '00000000-0000-4000-8000-0000000086d4','CTN86A-4','verified', NOW());

-- Flip the route to in_transit: trg_pickup_routes_set_manifest_reception_status
-- (20260625000001:164-212) creates route_receptions with expected_count=4
-- (distinct verified package_ids: d1, d2, d3, d4).
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '00000000-0000-4000-8000-0000000086f1';

-- Second route (PR-86B), for the empty-p_items / scoping assertions.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('00000000-0000-4000-8000-0000000086f2','00000000-0000-4000-8000-0000000086a0','PR-86B-1','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086b2','in_progress')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests
   SET pickup_route_id = '00000000-0000-4000-8000-0000000086f2'
 WHERE operator_id = '00000000-0000-4000-8000-0000000086a0'
   AND external_load_id = 'CARGA-86A-2';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('00000000-0000-4000-8000-0000000086a0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-2'),
   '00000000-0000-4000-8000-0000000086d5','CTN86A-5','verified', NOW());

UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '00000000-0000-4000-8000-0000000086f2';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000086a1","operator_id":"00000000-0000-4000-8000-0000000086a0","role":"authenticated"}',
  true
);

-- CTN86A-1 is scanned received at reception. CTN86A-2, CTN86A-4 are never
-- scanned at reception at all -- CTN86A-4's package is soft-deleted so it
-- must not appear as missing. CTN86A-3 WAS scanned 'received', but that scan
-- is soft-deleted below -- mutation guard for `rs.deleted_at IS NULL`: without
-- it, this soft-deleted 'received' row would make CTN86A-3 look already
-- received, and it would never open a missing discrepancy at all.
INSERT INTO public.reception_scans (id, reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES
  ('00000000-0000-4000-8000-0000000086aa',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'),
   '00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-1','received', NOW()),
  ('00000000-0000-4000-8000-0000000086ab',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'),
   '00000000-0000-4000-8000-0000000086d3','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-3','received', NOW());

UPDATE public.reception_scans
   SET deleted_at = NOW()
 WHERE id = '00000000-0000-4000-8000-0000000086ab';

-- PR-86B: fully received, nothing missing.
INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES
  ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2'),
   '00000000-0000-4000-8000-0000000086d5','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-5','received', NOW());

-- ── 1. Closing short (1/4 received) with a partial reasons payload records
--       exactly the missing set: CTN86A-2 (WITH the reason sent) and
--       CTN86A-3 (respaldo automático, NO reason sent) ────────────────────
SELECT lives_ok(
  $$ SELECT public.complete_route_reception(
       '00000000-0000-4000-8000-0000000086f1'::uuid,
       'Ruta llegó incompleta',
       jsonb_build_array(jsonb_build_object('package_id', '00000000-0000-4000-8000-0000000086d2', 'note', 'El local no lo entregó.'))
     ) $$,
  'closing 1/4 received with a discrepancy_notes comment does not raise'
);

SELECT is(
  (SELECT status::text FROM public.route_receptions
    WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'),
  'completed',
  'the route_reception is completed even though it closed short'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0'
      AND operation_type = 'reception'
      AND route_reception_id = (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1')
      AND deleted_at IS NULL),
  2,
  'complete_route_reception recorded exactly 2 open discrepancies (CTN86A-2, CTN86A-3) -- CTN86A-1 was received, CTN86A-4 is soft-deleted'
);

SELECT is(
  (SELECT (kind::text, status::text) FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d2'
      AND deleted_at IS NULL),
  ('missing'::text, 'open'::text),
  'CTN86A-2 (never reception-scanned) got an open missing discrepancy'
);

SELECT is(
  (SELECT note FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d2'
      AND deleted_at IS NULL),
  'El local no lo entregó.',
  'CTN86A-2 carries the reason the client sent in p_missing_reasons'
);

-- Respaldo automático: CTN86A-3 got NO entry in p_missing_reasons at all,
-- and it still opened a discrepancy, with a NULL note.
SELECT is(
  (SELECT note FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d3'
      AND deleted_at IS NULL),
  NULL,
  'CTN86A-3 (no reason sent by the client) still opened, with a NULL note -- the automatic backstop is the point'
);

-- Mutation guard: sin `p.deleted_at IS NULL`, CTN86A-4 (paquete borrado)
-- contaría y se registraría como faltante -- choca de frente con el
-- no-negociable de soft deletes.
SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d4'
      AND deleted_at IS NULL),
  0,
  'CTN86A-4 (the PACKAGE ITSELF is soft-deleted) is never recorded as missing'
);

-- CTN86A-1 (received) never gets a discrepancy of its own.
SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d1'
      AND deleted_at IS NULL),
  0,
  'CTN86A-1 (received at reception) is never recorded as missing'
);

-- ── 2. A clean close (received = expected) does not fail, and records 0 ────
SELECT lives_ok(
  $$ SELECT public.complete_route_reception('00000000-0000-4000-8000-0000000086f2'::uuid) $$,
  'closing a route reception with received = expected does not raise (empty p_items, spec-85 M5)'
);

SELECT is(
  (SELECT status::text FROM public.route_receptions
    WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2'),
  'completed',
  'the clean close still completes the route_reception'
);

-- ── 3. Discrepancies are scoped to THIS route_reception, not the operator
--       at large ────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000086a0'
      AND route_reception_id = (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2')
      AND deleted_at IS NULL),
  0,
  'the clean route (PR-86B) has no discrepancies of its own'
);

-- ── 4. operator_id scoping: a caller from a DIFFERENT operator cannot close
--       (or read into existence) another tenant's route_reception ─────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000086b9","operator_id":"00000000-0000-4000-8000-0000000086b0","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT public.complete_route_reception('00000000-0000-4000-8000-0000000086f2'::uuid) $$,
  'route_reception for route 00000000-0000-4000-8000-0000000086f2 not found',
  'a caller from another operator cannot complete a route_reception it does not own -- v_operator scoping (get_operator_id()) still holds after this fase''s change'
);

SELECT * FROM finish();
ROLLBACK;
