-- pgTAP: spec-86 fase 3 — get_discrepancies_ops_control, la vista de
-- Discrepancias en Ops Control.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec86_fase3_ops_control_discrepancies_view.test.sql
--
-- Fixture: operator A has
--   pr1 (PR-863-1) -> manifest1 (CARGA-863-1) -> pkg1 (CTN863-1), ord1
--     -- never pickup-scanned -> a PICKUP-source 'missing' discrepancy
--   pr2 (PR-863-2) -> manifest2 (CARGA-863-2) -> pkg2 (CTN863-2), ord2
--     -- verified in pickup, never reception-scanned -> a RECEPTION-source
--        'missing' discrepancy, whose carga is derived via the LATERAL join
--        to pickup_scans (route_receptions itself carries no manifest_id)
-- Operator B is a second tenant with nothing, to prove isolation.
BEGIN;
SELECT plan(13);

-- ── Fixtures ────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug) VALUES
  ('cccccccc-cccc-cccc-cccc-000000000863','Spec863 Op A','spec863-op-a'),
  ('dddddddd-dddd-dddd-dddd-000000000863','Spec863 Op B (other tenant)','spec863-op-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token) VALUES
  ('cccccccc-0000-4000-a000-000000000863','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863a@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"cccccccc-cccc-cccc-cccc-000000000863"}'::jsonb, '{"full_name":"Driver 863A"}'::jsonb, NOW(), NOW(), '', ''),
  ('cccccccc-0000-4000-a000-000000000864','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863a2@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"cccccccc-cccc-cccc-cccc-000000000863"}'::jsonb, '{"full_name":"Driver 863A-2"}'::jsonb, NOW(), NOW(), '', ''),
  ('dddddddd-0000-4000-b000-000000000863','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863b@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"dddddddd-dddd-dddd-dddd-000000000863"}'::jsonb, '{"full_name":"Driver 863B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions) VALUES
  ('cccccccc-0000-4000-a000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','driver-863a@spec86.test','Driver 863A',ARRAY['pickup']),
  ('cccccccc-0000-4000-a000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','driver-863a2@spec86.test','Driver 863A-2',ARRAY['pickup']),
  ('dddddddd-0000-4000-b000-000000000863','dddddddd-dddd-dddd-dddd-000000000863','driver-863b@spec86.test','Driver 863B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('cccccccc-0000-4000-b000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','VEH-863-1', true),
  ('cccccccc-0000-4000-b000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','VEH-863-2', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, external_load_id, retailer_name, raw_data, imported_via, imported_at) VALUES
  ('cccccccc-0000-4000-c000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-1','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-1','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-2','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-2','Retailer 863','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status) VALUES
  ('cccccccc-0000-4000-d000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000863','CTN863-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('cccccccc-0000-4000-d000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000864','CTN863-2','[]'::jsonb,'{}'::jsonb,'verificado')
ON CONFLICT (id) DO NOTHING;

-- Manifests are auto-created by trg_ensure_manifest_for_order on the order
-- INSERT above (spec80_fase2's fixture pattern, reused by spec86_fase1's
-- own test).
UPDATE public.manifests SET status = 'completed', started_at = NOW()
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id IN ('CARGA-863-1','CARGA-863-2');

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('cccccccc-0000-4000-e000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','PR-863-1','cccccccc-0000-4000-a000-000000000863','cccccccc-0000-4000-b000-000000000863','in_progress'),
  ('cccccccc-0000-4000-e000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','PR-863-2','cccccccc-0000-4000-a000-000000000864','cccccccc-0000-4000-b000-000000000864','in_progress')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests SET pickup_route_id = 'cccccccc-0000-4000-e000-000000000863'
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1';
UPDATE public.manifests SET pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2';

-- pkg2 (route 2) is verified in pickup; pkg1 (route 1) never is — it is the
-- PICKUP-source discrepancy, declared missing at manifest close.
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at) VALUES
  ('cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2'),
   'cccccccc-0000-4000-d000-000000000864','CTN863-2','verified', NOW());

-- Flips both routes to in_transit, which auto-creates their route_receptions
-- rows (trg_pickup_routes_status_sync, 20260625000001).
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id IN ('cccccccc-0000-4000-e000-000000000863','cccccccc-0000-4000-e000-000000000864');

-- pr2's reception never receives pkg2 -- no reception_scans row for it.

-- ── Record the two discrepancies exactly as production callers do ────────
-- Pickup source: close_manifest's caller (spec-80 fase 2).
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT public.record_discrepancies(
  'pickup'::public.discrepancy_operation_enum,
  (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000863','note','El local no lo entregó.'))
);

-- Reception source: complete_route_reception's caller (spec-86 fase 1),
-- a different closer than the pickup one.
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000864","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT public.record_discrepancies(
  'reception'::public.discrepancy_operation_enum,
  (SELECT id FROM public.route_receptions WHERE pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000864'))
);

-- ── 1. Default (p_status = 'open') returns both, enriched ────────────────
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control()), 2, 'both open discrepancies come back with the default filter');

SELECT is(
  (SELECT order_number || '|' || package_label || '|' || carga || '|' || ruta || '|' || closed_by_name
     FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-1'),
  'ORD-863-1|CTN863-1|CARGA-863-1|PR-863-1|Driver 863A',
  'pickup-source row: order, package, carga and ruta come straight off manifest_id -- no LATERAL needed'
);
SELECT is(
  (SELECT operation_type::text FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-1'),
  'pickup', 'pickup-source row is tagged operation_type=pickup'
);

SELECT is(
  (SELECT order_number || '|' || package_label || '|' || carga || '|' || ruta || '|' || closed_by_name
     FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-2'),
  'ORD-863-2|CTN863-2|CARGA-863-2|PR-863-2|Driver 863A-2',
  'reception-source row: carga is derived via the LATERAL pickup_scans join, ruta via route_receptions.pickup_route_id'
);
SELECT is(
  (SELECT operation_type::text FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-2'),
  'reception', 'reception-source row is tagged operation_type=reception'
);

-- ── 2. Resolving one drops it from the default (open) view ───────────────
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT is(
  (SELECT status::text FROM public.resolve_discrepancy(
     (SELECT id FROM public.discrepancies WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND package_id = 'cccccccc-0000-4000-d000-000000000863' AND deleted_at IS NULL),
     'resolved', 'apareció en el andén'
   )),
  'resolved', 'pkg1''s discrepancy is resolved'
);

SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control()), 1, 'default view now shows only the still-open reception-source row');
SELECT is((SELECT package_label FROM public.get_discrepancies_ops_control() LIMIT 1), 'CTN863-2', 'the remaining open row is pkg2, not the resolved pkg1');

-- ── 3. p_status='resolved' and p_status=NULL widen the filter ────────────
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control('resolved')), 1, 'p_status=resolved returns exactly the row just resolved');
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control(NULL)), 2, 'p_status=NULL returns every status, open and resolved alike');

-- ── 4. Tenant isolation: operator B sees nothing of operator A's ─────────
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-b000-000000000863","operator_id":"dddddddd-dddd-dddd-dddd-000000000863","role":"authenticated"}', true);
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control(NULL)), 0, 'operator B sees none of operator A''s discrepancies, even unfiltered by status');

-- ── 5. A barcode-only ("unexpected") row never breaks the query ──────────
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT public.record_discrepancies(
  'pickup'::public.discrepancy_operation_enum,
  (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1'),
  jsonb_build_array(jsonb_build_object('kind','unexpected','barcode','FOREIGN-BARCODE-1'))
);
SELECT lives_ok(
  $$ SELECT * FROM public.get_discrepancies_ops_control(NULL) $$,
  'a package_id-less (unexpected) row does not break the join chain'
);
SELECT is(
  (SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control(NULL) WHERE package_label IS NULL AND order_number IS NULL),
  1, 'the unexpected row surfaces with no order/package rather than a wrong one'
);

SELECT * FROM finish();
ROLLBACK;
