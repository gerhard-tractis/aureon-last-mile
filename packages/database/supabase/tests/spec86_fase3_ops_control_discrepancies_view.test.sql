-- pgTAP: spec-86 fase 3 — get_discrepancies_ops_control, la vista de
-- Discrepancias en Ops Control.
--
-- Run against a local Supabase instance, via RAW psql -tA -f, NOT
-- scripts/pgtap-local.sh's `run` subcommand (ronda 2 de review, #715 B2):
-- that wrapper decides PASS/FAIL with `grep -qE "ERROR:|^psql: error:"`, and
-- a failed pgTAP assertion emits `not ok N`, never `ERROR:` — the wrapper
-- reports PASS on a real failure. Fix despachado aparte; hasta que aterrice,
-- la única evidencia válida es la salida cruda:
--   MSYS_NO_PATHCONV=1 docker exec spec52-pg psql -U postgres -d postgres \
--     -tA -f /supabase/tests/spec86_fase3_ops_control_discrepancies_view.test.sql
--
-- Fixture: operator A has
--   pr1 (PR-863-1) -> manifest1 (CARGA-863-1) -> pkg1 (CTN863-1), never
--     pickup-scanned -> a PICKUP-source 'missing' discrepancy.
--   pr2 (PR-863-2) -> manifest2 (CARGA-863-2) -> pkg2 (CTN863-2), verified
--     in pickup, never reception-scanned -> a RECEPTION-source 'missing'
--     discrepancy. pkg2 ALSO has four more pickup_scans candidates that
--     must NOT win the LATERAL's "which carga" pick (ronda 2, B3 — the
--     mutants that survived round 1 because every route had exactly one
--     manifest, so nothing distinguished "the right predicate" from "no
--     predicate at all"):
--       - manifest2c/route2, verified, EARLIER than the true scan -> proves
--         ORDER BY ... DESC is load-bearing, not just LIMIT 1.
--       - manifest2b/route2, not_found, LATER than the true scan ->
--         proves the scan_result='verified' filter is load-bearing.
--       - manifest4/route4 (a DIFFERENT route), verified, LATEST of all ->
--         proves the m.pickup_route_id = rr.pickup_route_id filter is
--         load-bearing.
--       - manifest2d/route2, verified, MOST recent of all but soft-deleted
--         -> proves ps.deleted_at IS NULL is load-bearing.
--     pkg2's carga must resolve to CARGA-863-2 (manifest2) despite all four.
--   pkg3 (CTN863-3) — a second RECEPTION-source discrepancy on the SAME
--     route_reception as pkg2, later marked 'lost' by an operations_manager:
--     the B1 fixture. Its carga is derived off manifest2 too (reused,
--     deliberately — a package can be scanned onto any manifest of its
--     route; the trigger picks by package_id, not by "the manifest it was
--     declared under").
--   pkg6 (CTN863-6) — a PICKUP-source discrepancy immediately soft-deleted,
--     to prove d.deleted_at IS NULL is load-bearing.
-- Operator B has its OWN pickup-source discrepancy (pkgB1) — NOT an empty
-- tenant. An empty operator B cannot distinguish "the join-level operator_id
-- filters work" from "there was nothing to leak" (ronda 2, B3).
BEGIN;
SELECT plan(33);

-- ── Fixtures — operators, users, vehicles ─────────────────────────────────
INSERT INTO public.operators (id, name, slug) VALUES
  ('cccccccc-cccc-cccc-cccc-000000000863','Spec863 Op A','spec863-op-a'),
  ('dddddddd-dddd-dddd-dddd-000000000863','Spec863 Op B (other tenant)','spec863-op-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token) VALUES
  ('cccccccc-0000-4000-a000-000000000863','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863a@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"cccccccc-cccc-cccc-cccc-000000000863"}'::jsonb, '{"full_name":"Driver 863A"}'::jsonb, NOW(), NOW(), '', ''),
  ('cccccccc-0000-4000-a000-000000000864','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863a2@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"cccccccc-cccc-cccc-cccc-000000000863"}'::jsonb, '{"full_name":"Driver 863A-2"}'::jsonb, NOW(), NOW(), '', ''),
  ('cccccccc-0000-4000-a000-000000000865','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863a3@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"cccccccc-cccc-cccc-cccc-000000000863"}'::jsonb, '{"full_name":"Driver 863A-3"}'::jsonb, NOW(), NOW(), '', ''),
  ('cccccccc-0000-4000-a000-000000000870','00000000-0000-0000-0000-000000000000','authenticated','authenticated','opsmgr-863a@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"cccccccc-cccc-cccc-cccc-000000000863"}'::jsonb, '{"full_name":"Ops Manager 863A"}'::jsonb, NOW(), NOW(), '', ''),
  ('dddddddd-0000-4000-b000-000000000863','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-863b@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"dddddddd-dddd-dddd-dddd-000000000863"}'::jsonb, '{"full_name":"Driver 863B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions, role) VALUES
  ('cccccccc-0000-4000-a000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','driver-863a@spec86.test','Driver 863A',ARRAY['pickup'],'pickup_crew'),
  ('cccccccc-0000-4000-a000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','driver-863a2@spec86.test','Driver 863A-2',ARRAY['pickup'],'pickup_crew'),
  ('cccccccc-0000-4000-a000-000000000865','cccccccc-cccc-cccc-cccc-000000000863','driver-863a3@spec86.test','Driver 863A-3',ARRAY['pickup'],'pickup_crew'),
  ('cccccccc-0000-4000-a000-000000000870','cccccccc-cccc-cccc-cccc-000000000863','opsmgr-863a@spec86.test','Ops Manager 863A',ARRAY['pickup'],'operations_manager'),
  ('dddddddd-0000-4000-b000-000000000863','dddddddd-dddd-dddd-dddd-000000000863','driver-863b@spec86.test','Driver 863B',ARRAY['pickup'],'pickup_crew')
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions, role = EXCLUDED.role;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('cccccccc-0000-4000-b000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','VEH-863-1', true),
  ('cccccccc-0000-4000-b000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','VEH-863-2', true),
  ('cccccccc-0000-4000-b000-000000000865','cccccccc-cccc-cccc-cccc-000000000863','VEH-863-3', true),
  ('dddddddd-0000-4000-f000-000000000863','dddddddd-dddd-dddd-dddd-000000000863','VEH-863-B1', true)
ON CONFLICT DO NOTHING;

-- ── Fixtures — orders, packages (manifests auto-created per external_load_id) ──
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, external_load_id, retailer_name, raw_data, imported_via, imported_at) VALUES
  ('cccccccc-0000-4000-c000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-1','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-1','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-2','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-2','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-00000000086b','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-2B','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-2B','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-00000000086c','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-2C','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-2C','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-00000000086d','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-2D','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-2D','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000865','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-3','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-3','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000866','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-4','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-4','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000867','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-6','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-6','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('dddddddd-0000-4000-c000-000000000863','dddddddd-dddd-dddd-dddd-000000000863','ORD-863-B1','Cliente 863B','+56922222222','Calle 863B','Santiago', CURRENT_DATE, 'CARGA-863-B1','Retailer 863B','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status) VALUES
  ('cccccccc-0000-4000-d000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000863','CTN863-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('cccccccc-0000-4000-d000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000864','CTN863-2','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('cccccccc-0000-4000-d000-000000000865','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000865','CTN863-3','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('cccccccc-0000-4000-d000-000000000867','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000867','CTN863-6','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('dddddddd-0000-4000-d000-000000000863','dddddddd-dddd-dddd-dddd-000000000863','dddddddd-0000-4000-c000-000000000863','CTN863-B1','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests SET status = 'completed', started_at = NOW()
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863'
   AND external_load_id IN ('CARGA-863-1','CARGA-863-2','CARGA-863-2B','CARGA-863-2C','CARGA-863-2D','CARGA-863-3','CARGA-863-4','CARGA-863-6');
UPDATE public.manifests SET status = 'completed', started_at = NOW()
 WHERE operator_id = 'dddddddd-dddd-dddd-dddd-000000000863' AND external_load_id = 'CARGA-863-B1';

-- ── Fixtures — routes. route2 carries manifest2/2b/2c/2d (four manifests,
-- one route) so the LATERAL has real ambiguity to resolve; route4 is a
-- second, unrelated route/manifest pair. ──────────────────────────────────
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('cccccccc-0000-4000-e000-000000000863','cccccccc-cccc-cccc-cccc-000000000863','PR-863-1','cccccccc-0000-4000-a000-000000000863','cccccccc-0000-4000-b000-000000000863','in_progress'),
  ('cccccccc-0000-4000-e000-000000000864','cccccccc-cccc-cccc-cccc-000000000863','PR-863-2','cccccccc-0000-4000-a000-000000000864','cccccccc-0000-4000-b000-000000000864','in_progress'),
  ('cccccccc-0000-4000-e000-000000000866','cccccccc-cccc-cccc-cccc-000000000863','PR-863-4','cccccccc-0000-4000-a000-000000000865','cccccccc-0000-4000-b000-000000000865','in_progress'),
  ('dddddddd-0000-4000-e000-000000000863','dddddddd-dddd-dddd-dddd-000000000863','PR-863-B1','dddddddd-0000-4000-b000-000000000863','dddddddd-0000-4000-f000-000000000863','in_progress')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests SET pickup_route_id = 'cccccccc-0000-4000-e000-000000000863'
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1';
UPDATE public.manifests SET pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id IN ('CARGA-863-2','CARGA-863-2B','CARGA-863-2C','CARGA-863-2D','CARGA-863-3');
UPDATE public.manifests SET pickup_route_id = 'cccccccc-0000-4000-e000-000000000866'
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-4';
-- CARGA-863-6 stays without a pickup_route_id — pkg6's discrepancy never
-- reaches a query that needs one (it is soft-deleted before any assertion).
UPDATE public.manifests SET pickup_route_id = 'dddddddd-0000-4000-e000-000000000863'
 WHERE operator_id = 'dddddddd-dddd-dddd-dddd-000000000863' AND external_load_id = 'CARGA-863-B1';

-- pkg2's four disambiguation candidates (see file header) plus the true
-- scan, and pkg3's scan (reused against manifest2, same route as pkg2's).
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at) VALUES
  ('cccccccc-0000-4000-9000-000000000801','cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2'),
   'cccccccc-0000-4000-d000-000000000864','CTN863-2','verified', NOW() - interval '3 hours'),
  ('cccccccc-0000-4000-9000-000000000802','cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2C'),
   'cccccccc-0000-4000-d000-000000000864','CTN863-2','verified', NOW() - interval '4 hours'),
  ('cccccccc-0000-4000-9000-000000000803','cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2B'),
   'cccccccc-0000-4000-d000-000000000864','CTN863-2-DUP','not_found', NOW() - interval '2 hours'),
  ('cccccccc-0000-4000-9000-000000000804','cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-4'),
   'cccccccc-0000-4000-d000-000000000864','CTN863-2-OTHERROUTE','verified', NOW() - interval '1 hours'),
  ('cccccccc-0000-4000-9000-000000000805','cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2D'),
   'cccccccc-0000-4000-d000-000000000864','CTN863-2-DELETED','verified', NOW()),
  ('cccccccc-0000-4000-9000-000000000806','cccccccc-cccc-cccc-cccc-000000000863',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2'),
   'cccccccc-0000-4000-d000-000000000865','CTN863-3','verified', NOW() - interval '1 hours');

-- The most-recent, correct-route, verified candidate is soft-deleted — must
-- not win (ps.deleted_at IS NULL).
UPDATE public.pickup_scans SET deleted_at = NOW() WHERE id = 'cccccccc-0000-4000-9000-000000000805';

-- Flips all three of operator A's routes (and B's) to in_transit, which
-- auto-creates their route_receptions rows.
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id IN (
   'cccccccc-0000-4000-e000-000000000863','cccccccc-0000-4000-e000-000000000864',
   'cccccccc-0000-4000-e000-000000000866','dddddddd-0000-4000-e000-000000000863'
 );

-- ── Record discrepancies exactly as production callers do ────────────────
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT public.record_discrepancies(
  'pickup'::public.discrepancy_operation_enum,
  (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000863','note','El local no lo entregó.'))
);
SELECT public.record_discrepancies(
  'pickup'::public.discrepancy_operation_enum,
  (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-6'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000867'))
);
-- Immediately soft-deleted -- must never surface (d.deleted_at IS NULL).
UPDATE public.discrepancies SET deleted_at = NOW()
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND package_id = 'cccccccc-0000-4000-d000-000000000867';

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000864","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT public.record_discrepancies(
  'reception'::public.discrepancy_operation_enum,
  (SELECT id FROM public.route_receptions WHERE pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'),
  jsonb_build_array(
    jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000864'),
    jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000865')
  )
);

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-b000-000000000863","operator_id":"dddddddd-dddd-dddd-dddd-000000000863","role":"authenticated"}', true);
SELECT public.record_discrepancies(
  'pickup'::public.discrepancy_operation_enum,
  (SELECT id FROM public.manifests WHERE operator_id = 'dddddddd-dddd-dddd-dddd-000000000863' AND external_load_id = 'CARGA-863-B1'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','dddddddd-0000-4000-d000-000000000863'))
);

-- ── 1. Default (p_status = 'open') = pkg1 + pkg2 + pkg3, not pkg6 ────────
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control()), 3, 'default filter: pkg1 + pkg2 + pkg3, pkg6 excluded (soft-deleted)');
SELECT is(
  (SELECT DISTINCT total_count FROM public.get_discrepancies_ops_control()),
  3::bigint, 'total_count (#715 M3) matches the real row count and is identical across every returned row'
);

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

-- The load-bearing one: pkg2's carga must survive four decoys (earlier
-- verified, later-but-wrong-result, later-but-wrong-route, latest-but-
-- deleted) and still resolve to the true scan's manifest.
SELECT is(
  (SELECT order_number || '|' || package_label || '|' || carga || '|' || ruta || '|' || closed_by_name
     FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-2'),
  'ORD-863-2|CTN863-2|CARGA-863-2|PR-863-2|Driver 863A-2',
  'reception-source row: carga survives 4 decoy pickup_scans (wrong order, wrong result, wrong route, deleted) via ORDER BY DESC + scan_result + route scoping + deleted_at'
);
SELECT is(
  (SELECT operation_type::text FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-2'),
  'reception', 'reception-source row is tagged operation_type=reception'
);
SELECT is(
  (SELECT carga FROM public.get_discrepancies_ops_control() WHERE package_label = 'CTN863-3'),
  'CARGA-863-2', 'pkg3''s carga resolves off the manifest it was actually scanned against, same LATERAL logic'
);

-- ── 2. B1 — declaring 'lost' must NOT clear the default (open-queue) view ─
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000870","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT is(
  (SELECT status::text FROM public.resolve_discrepancy(
     (SELECT id FROM public.discrepancies WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND package_id = 'cccccccc-0000-4000-d000-000000000865' AND deleted_at IS NULL),
     'lost', 'nunca apareció -- se declara pérdida'
   )),
  'lost', 'the operations_manager declares pkg3 lost'
);
SELECT is(
  (SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control()), 3,
  'B1 (#715): declaring lost does NOT shrink the default queue -- lost is still unresolved action, not a clean close'
);
SELECT is(
  (SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control('lost')), 1,
  'p_status=''lost'' is still a literal filter, not widened like ''open'' is'
);

-- ── 3. Resolving (not losing) IS what drops a row from the default view ──
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT is(
  (SELECT status::text FROM public.resolve_discrepancy(
     (SELECT id FROM public.discrepancies WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND package_id = 'cccccccc-0000-4000-d000-000000000863' AND deleted_at IS NULL),
     'resolved', 'apareció en el andén'
   )),
  'resolved', 'pkg1''s discrepancy is resolved'
);
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control()), 2, 'default view now shows pkg2 (open) + pkg3 (lost), not pkg1 (resolved)');
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control('resolved')), 1, 'p_status=resolved returns exactly pkg1');
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control(NULL)), 3, 'p_status=NULL returns every non-deleted status: resolved + open + lost');

-- ── 4. Tenant isolation — operator B has REAL data, not an empty tenant ──
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-b000-000000000863","operator_id":"dddddddd-dddd-dddd-dddd-000000000863","role":"authenticated"}', true);
SELECT is((SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control(NULL)), 1, 'operator B sees exactly its own row, not operator A''s three');
SELECT is((SELECT package_label FROM public.get_discrepancies_ops_control(NULL) LIMIT 1), 'CTN863-B1', 'and it is B''s own package, not one of A''s');

-- ── 4b. A corrupted cross-tenant reference is not enriched with the other
--       tenant's data (ronda 2, B3 — "dale datos a B" alone does not catch a
--       missing operator_id filter inside a join keyed by UUID primary key:
--       two tenants' ids never collide by accident, so the ONLY way any of
--       the nine per-join operator_id filters is load-bearing is a row whose
--       FK points at the WRONG tenant's object — exactly what
--       record_discrepancies' own ownership guard exists to prevent on the
--       write path (20260913000003), and exactly why this defense-in-depth
--       read-side filter cannot be exercised through that RPC. Inserted
--       directly, bypassing it, the way a future bug would actually produce
--       this row.
--
--       Ronda 3 (#715, M4): this ONE corrupted package_id only proves the
--       `packages` filter. Measured one predicate at a time (not "all nine
--       removed together", which the corrupted row above passed on with only
--       ONE of the nine actually exercised — p becomes NULL first, so o's
--       own filter is never reached, same masking class M4 caught): 8 more
--       scenarios below, each corrupting exactly ONE join's target while
--       keeping every other hop genuinely valid, so each predicate is the
--       ONLY thing standing between NULL and a leak in its own assertion.
--       Measured one mutation at a time against spec52-pg (o, pm, prp, prr,
--       u, ps, m: 7/7 kill on their own assertion and no other). rr is the
--       exception, declared honestly where its scenario lives below: prr's
--       own filter already blocks the only column rr's data could leak
--       through, so rr's removal alone does not flip any assertion —real
--       defense-in-depth, not independently observable today. 8/9 total
--       joins now have a scenario that isolates them; the ninth (rr) has a
--       scenario and an honest note on why it cannot be isolated further. ──
INSERT INTO public.discrepancies (id, operator_id, kind, operation_type, package_id, manifest_id, detected_by_user_id, note) VALUES
  ('cccccccc-0000-4000-9999-000000000001','cccccccc-cccc-cccc-cccc-000000000863','missing','pickup',
   'dddddddd-0000-4000-d000-000000000863', -- operator B's package_id, on an operator-A row
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1'),
   'cccccccc-0000-4000-a000-000000000863','fixture de referencia cruzada corrupta');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-a000-000000000863","operator_id":"cccccccc-cccc-cccc-cccc-000000000863","role":"authenticated"}', true);
SELECT is(
  (SELECT package_label FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000001'),
  NULL, 'p: a package_id pointing at another tenant''s package is not enriched with that tenant''s label'
);
SELECT is(
  (SELECT order_number FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000001'),
  NULL, 'nor with that tenant''s order_number, via the same corrupted package_id'
);

-- ── 4c. The other 8 joins, one corrupted FK per scenario ──────────────────
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, external_load_id, retailer_name, raw_data, imported_via, imported_at) VALUES
  ('cccccccc-0000-4000-c000-000000000870','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-7','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-7','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000871','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-8','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-8','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000872','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-9','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-9','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000874','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-11','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-11','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000875','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-12','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-12','Retailer 863','{}'::jsonb,'MANUAL', NOW()),
  ('cccccccc-0000-4000-c000-000000000876','cccccccc-cccc-cccc-cccc-000000000863','ORD-863-8B','Cliente 863','+56911111111','Calle 863','Santiago', CURRENT_DATE, 'CARGA-863-8B','Retailer 863','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status) VALUES
  ('cccccccc-0000-4000-d000-000000000870','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000870','CTN863-7','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('cccccccc-0000-4000-d000-000000000871','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000871','CTN863-8','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('cccccccc-0000-4000-d000-000000000872','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000872','CTN863-9','[]'::jsonb,'{}'::jsonb,'ingresado'),
  -- o: an A-owned package whose order_id points at operator B's own order.
  ('cccccccc-0000-4000-d000-000000000873','cccccccc-cccc-cccc-cccc-000000000863','dddddddd-0000-4000-c000-000000000863','CTN863-10','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('cccccccc-0000-4000-d000-000000000874','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000874','CTN863-11','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('cccccccc-0000-4000-d000-000000000875','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000875','CTN863-12','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('cccccccc-0000-4000-d000-000000000876','cccccccc-cccc-cccc-cccc-000000000863','cccccccc-0000-4000-c000-000000000876','CTN863-8B','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests SET status = 'completed', started_at = NOW()
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863'
   AND external_load_id IN ('CARGA-863-7','CARGA-863-8','CARGA-863-9','CARGA-863-11','CARGA-863-12','CARGA-863-8B');

-- o: pkg10's own order_id (above) already points at B's order — no more
-- setup needed. A perfectly ordinary discrepancy referencing it.
SELECT public.record_discrepancies(
  'pickup'::public.discrepancy_operation_enum,
  (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000873'))
);
SELECT is(
  (SELECT package_label FROM public.get_discrepancies_ops_control(NULL) WHERE package_label = 'CTN863-10'),
  'CTN863-10', 'o: the package itself (A''s own) still resolves correctly'
);
SELECT is(
  (SELECT order_number FROM public.get_discrepancies_ops_control(NULL) WHERE package_label = 'CTN863-10'),
  NULL, 'o: but order_number does not leak operator B''s order, via the package''s own corrupted order_id'
);

-- pm (+ prp downstream of it): manifest_id points directly at operator B's
-- real manifest. package_id stays A's own valid pkg7, so a leak here is
-- attributable to pm specifically, not to an already-NULL package join.
INSERT INTO public.discrepancies (id, operator_id, kind, operation_type, package_id, manifest_id, detected_by_user_id, note) VALUES
  ('cccccccc-0000-4000-9999-000000000002','cccccccc-cccc-cccc-cccc-000000000863','missing','pickup',
   'cccccccc-0000-4000-d000-000000000870',
   (SELECT id FROM public.manifests WHERE operator_id = 'dddddddd-dddd-dddd-dddd-000000000863' AND external_load_id = 'CARGA-863-B1'),
   'cccccccc-0000-4000-a000-000000000863','fixture pm corrupto');
SELECT is(
  (SELECT package_label FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000002'),
  'CTN863-7', 'pm: the package (A''s own) still resolves'
);
SELECT is(
  (SELECT carga FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000002'),
  NULL, 'pm: carga does not leak operator B''s manifest, via a manifest_id pointing straight at it'
);

-- prp: manifest_id points at an A-owned manifest that resolves fine (pm
-- correct), but THAT manifest's own pickup_route_id is corrupted to point at
-- operator B's route — isolates prp's filter from pm's.
UPDATE public.manifests SET pickup_route_id = 'dddddddd-0000-4000-e000-000000000863'
 WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-7';
INSERT INTO public.discrepancies (id, operator_id, kind, operation_type, package_id, manifest_id, detected_by_user_id, note) VALUES
  ('cccccccc-0000-4000-9999-000000000003','cccccccc-cccc-cccc-cccc-000000000863','missing','pickup',
   'cccccccc-0000-4000-d000-000000000871',
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-7'),
   'cccccccc-0000-4000-a000-000000000863','fixture prp corrupto');
SELECT is(
  (SELECT carga FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000003'),
  'CARGA-863-7', 'prp: carga (from pm, unaffected) still resolves'
);
SELECT is(
  (SELECT ruta FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000003'),
  NULL, 'prp: but ruta does not leak operator B''s route code, via the manifest''s own corrupted pickup_route_id'
);

-- rr: route_reception_id points directly at operator B's real route_reception.
--
-- Ronda 3 (#715, M4 follow-up), honestly declared rather than overclaimed:
-- measured, removing ONLY rr's own operator_id filter does NOT flip this
-- assertion -- prr's independent filter (confirmed above to kill on its own)
-- already blocks the route code from propagating, because ruta only ever
-- reaches the client through prr, never through rr directly. rr's own
-- operator_id filter is real defense-in-depth (it would matter the moment a
-- future column selects off rr.* directly, or if prr's filter were ever
-- weakened at the same time), but it is NOT independently observable through
-- today's output columns -- the same class of finding as the COALESCE fixed
-- above by the CASE rewrite, except here restructuring the query to force
-- independence is not worth doing for a filter with no live column to leak
-- through. The two assertions below still hold and still regression-test the
-- no-leak property end to end; they just don't isolate rr from prr.
INSERT INTO public.discrepancies (id, operator_id, kind, operation_type, package_id, route_reception_id, detected_by_user_id, note) VALUES
  ('cccccccc-0000-4000-9999-000000000004','cccccccc-cccc-cccc-cccc-000000000863','missing','reception',
   'cccccccc-0000-4000-d000-000000000872',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = 'dddddddd-0000-4000-e000-000000000863'),
   'cccccccc-0000-4000-a000-000000000864','fixture rr corrupto');
SELECT is(
  (SELECT package_label FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000004'),
  'CTN863-9', 'rr: the package (A''s own) still resolves'
);
SELECT is(
  (SELECT ruta FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000004'),
  NULL, 'rr+prr: ruta does not leak operator B''s route (see comment above: this pins the pair, not rr alone)'
);

-- prr: route_reception_id points at A's OWN route_reception (route1's,
-- otherwise unused so far), which resolves fine (rr correct) -- but THAT
-- row's own pickup_route_id is corrupted to point at operator B's route.
-- Isolates prr's filter from rr's. A SECOND B route (routeB2) is needed as
-- the corruption target -- uniq_route_receptions_pickup_route blocks two
-- route_receptions pointing at the SAME pickup_route_id, and rrB1 already
-- points at routeB1.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('dddddddd-0000-4000-e000-000000000864','dddddddd-dddd-dddd-dddd-000000000863','PR-863-B2','dddddddd-0000-4000-b000-000000000863','dddddddd-0000-4000-f000-000000000863','in_progress')
ON CONFLICT (id) DO NOTHING;
UPDATE public.route_receptions SET pickup_route_id = 'dddddddd-0000-4000-e000-000000000864'
 WHERE pickup_route_id = 'cccccccc-0000-4000-e000-000000000863';
INSERT INTO public.discrepancies (id, operator_id, kind, operation_type, package_id, route_reception_id, detected_by_user_id, note) VALUES
  ('cccccccc-0000-4000-9999-000000000005','cccccccc-cccc-cccc-cccc-000000000863','missing','reception',
   'cccccccc-0000-4000-d000-000000000876',
   -- rr1, the only A-owned route_reception now pointing at B's routeB2.
   (SELECT id FROM public.route_receptions
     WHERE pickup_route_id = 'dddddddd-0000-4000-e000-000000000864'
       AND operator_id = 'cccccccc-cccc-cccc-cccc-000000000863'),
   'cccccccc-0000-4000-a000-000000000863','fixture prr corrupto');
SELECT is(
  (SELECT ruta FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000005'),
  NULL, 'prr: ruta does not leak operator B''s route, via route1''s reception''s own corrupted pickup_route_id'
);

-- u: detected_by_user_id points directly at operator B's real user.
INSERT INTO public.discrepancies (id, operator_id, kind, operation_type, package_id, manifest_id, detected_by_user_id, note) VALUES
  ('cccccccc-0000-4000-9999-000000000006','cccccccc-cccc-cccc-cccc-000000000863','missing','pickup',
   'cccccccc-0000-4000-d000-000000000870', -- reuses pkg7; already resolved above (independent column)
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-1'),
   'dddddddd-0000-4000-b000-000000000863','fixture u corrupto');
SELECT is(
  (SELECT closed_by_name FROM public.get_discrepancies_ops_control(NULL) WHERE id = 'cccccccc-0000-4000-9999-000000000006'),
  NULL, 'u: closed_by_name does not leak operator B''s user, via a detected_by_user_id pointing straight at it'
);

-- ps (inside the LATERAL): the only 'verified' scan for pkg11, on A's own
-- manifest2/route2 (a genuinely matching route), is owned by operator B.
SELECT public.record_discrepancies(
  'reception'::public.discrepancy_operation_enum,
  (SELECT id FROM public.route_receptions WHERE pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000874'))
);
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at) VALUES
  ('cccccccc-0000-4000-9000-000000000807','dddddddd-dddd-dddd-dddd-000000000863', -- operator B's scan
   (SELECT id FROM public.manifests WHERE operator_id = 'cccccccc-cccc-cccc-cccc-000000000863' AND external_load_id = 'CARGA-863-2'),
   'cccccccc-0000-4000-d000-000000000874','CTN863-11-FOREIGNSCAN','verified', NOW());
SELECT is(
  (SELECT carga FROM public.get_discrepancies_ops_control(NULL) WHERE package_label = 'CTN863-11'),
  NULL, 'ps: carga does not leak via a matching scan owned by another tenant, even on A''s own correct manifest/route'
);

-- m (inside the LATERAL): pkg12's own scan is A-owned and 'verified', but
-- its manifest_id points at operator B's manifest -- whose pickup_route_id
-- is corrupted (here) to equal A's route2, so only m's own filter stands
-- between NULL and a leak.
UPDATE public.manifests SET pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'
 WHERE operator_id = 'dddddddd-dddd-dddd-dddd-000000000863' AND external_load_id = 'CARGA-863-B1';
SELECT public.record_discrepancies(
  'reception'::public.discrepancy_operation_enum,
  (SELECT id FROM public.route_receptions WHERE pickup_route_id = 'cccccccc-0000-4000-e000-000000000864'),
  jsonb_build_array(jsonb_build_object('kind','missing','package_id','cccccccc-0000-4000-d000-000000000875'))
);
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at) VALUES
  ('cccccccc-0000-4000-9000-000000000808','cccccccc-cccc-cccc-cccc-000000000863', -- A's own scan
   (SELECT id FROM public.manifests WHERE operator_id = 'dddddddd-dddd-dddd-dddd-000000000863' AND external_load_id = 'CARGA-863-B1'),
   'cccccccc-0000-4000-d000-000000000875','CTN863-12-FOREIGNMANIFEST','verified', NOW());
SELECT is(
  (SELECT carga FROM public.get_discrepancies_ops_control(NULL) WHERE package_label = 'CTN863-12'),
  NULL, 'm: carga does not leak via a scan on a manifest owned by another tenant, even one route-matched by coincidence'
);

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
  (SELECT COUNT(*)::int FROM public.get_discrepancies_ops_control(NULL) WHERE kind = 'unexpected' AND package_label IS NULL AND order_number IS NULL),
  1, 'the unexpected row surfaces with no order/package rather than a wrong one'
);

-- ── 6. Minor #2 (#715) — a soft-deleted closer is not attributed a name ──
UPDATE public.users SET deleted_at = NOW() WHERE id = 'cccccccc-0000-4000-a000-000000000864';
SELECT is(
  (SELECT closed_by_name FROM public.get_discrepancies_ops_control(NULL) WHERE package_label = 'CTN863-2'),
  NULL, 'a soft-deleted closer (u.deleted_at) is not surfaced by name'
);

SELECT * FROM finish();
ROLLBACK;
