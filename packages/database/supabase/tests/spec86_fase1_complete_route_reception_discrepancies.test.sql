-- pgTAP: spec-86 fase 1 — complete_route_reception records discrepancies via
-- record_discrepancies (spec-85 fase 2), operation_type='reception'.
--
-- PR-86A-1 (route f1), manifest CARGA-86A-1, packages:
--   d1 CTN86A-1 — received on THIS reception             -> not missing
--   d2 CTN86A-2 — never scanned                           -> missing, w/ reason
--   d3 CTN86A-3 — only 'received' scan is soft-deleted     -> missing, NULL note
--                 (mutation guard: rs.deleted_at IS NULL)
--   d4 CTN86A-4 — the PACKAGE ITSELF is soft-deleted       -> NOT missing at all
--                 (mutation guard: p.deleted_at IS NULL)
--   d6 CTN86A-6 — 'received', but on route f2's OWN reception, not f1's
--                 (arrived on another truck)               -> missing on f1
--                 (mutation guard: rs.reception_id = v_rr.id)
--   d7 CTN86A-7 — scanned on f1's reception, but 'route_mismatch', not
--                 'received'                                -> still missing
--                 (mutation guard: rs.scan_result = 'received')
-- PR-86B-1 (route f2), manifest CARGA-86A-2, package d5 — received in full,
-- proves the empty-p_items path (spec-85 M5) and per-route scoping.
BEGIN;
SELECT plan(18);

-- ── Fixtures ────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug) VALUES
  ('00000000-0000-4000-8000-0000000086a0','Spec86a Op A','spec86a-op-a'),
  ('00000000-0000-4000-8000-0000000086b0','Spec86a Op Z (other tenant)','spec86a-op-z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token) VALUES
  ('00000000-0000-4000-8000-0000000086a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-86a@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"00000000-0000-4000-8000-0000000086a0"}'::jsonb, '{"full_name":"Driver 86A"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-0000000086a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-86a2@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"00000000-0000-4000-8000-0000000086a0"}'::jsonb, '{"full_name":"Driver 86A-2"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-0000000086b9','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-86z@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"00000000-0000-4000-8000-0000000086b0"}'::jsonb, '{"full_name":"Driver 86Z"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions) VALUES
  ('00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086a0','driver-86a@spec86.test','Driver 86A',ARRAY['pickup']),
  ('00000000-0000-4000-8000-0000000086a2','00000000-0000-4000-8000-0000000086a0','driver-86a2@spec86.test','Driver 86A-2',ARRAY['pickup']),
  ('00000000-0000-4000-8000-0000000086b9','00000000-0000-4000-8000-0000000086b0','driver-86z@spec86.test','Driver 86Z',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('00000000-0000-4000-8000-0000000086b1','00000000-0000-4000-8000-0000000086a0','VEH-86A-1', true),
  ('00000000-0000-4000-8000-0000000086b2','00000000-0000-4000-8000-0000000086a0','VEH-86A-2', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, external_load_id, retailer_name, raw_data, imported_via, imported_at) VALUES
  ('00000000-0000-4000-8000-0000000086c0','00000000-0000-4000-8000-0000000086a0','ORD-86A-1','Cliente 86A','+56911111111','Calle 86A','Santiago', CURRENT_DATE, 'CARGA-86A-1','Retailer 86A','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000086c1','00000000-0000-4000-8000-0000000086a0','ORD-86A-2','Cliente 86A','+56911111111','Calle 86A','Santiago', CURRENT_DATE, 'CARGA-86A-2','Retailer 86A','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status) VALUES
  ('00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c0','CTN86A-1','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d2','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c0','CTN86A-2','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d3','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c0','CTN86A-3','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d4','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c0','CTN86A-4','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d5','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c1','CTN86A-5','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d6','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c0','CTN86A-6','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000086d7','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086c0','CTN86A-7','[]'::jsonb,'{}'::jsonb,'verificado')
ON CONFLICT (id) DO NOTHING;

-- d4: the package itself is soft-deleted (mutation guard, p.deleted_at IS NULL).
UPDATE public.packages SET deleted_at = NOW() WHERE id = '00000000-0000-4000-8000-0000000086d4';

-- Manifests are auto-created by trg_ensure_manifest_for_order on the order
-- INSERT above (spec80_fase2's fixture pattern) — not inserted by hand.
UPDATE public.manifests SET status = 'completed', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id IN ('CARGA-86A-1','CARGA-86A-2');

-- uniq_pickup_routes_one_active_per_driver allows only ONE 'in_progress'
-- route per driver -- f2 gets its own driver (86a2) so both routes can be
-- 'in_progress' at once without inserting them one at a time.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('00000000-0000-4000-8000-0000000086f1','00000000-0000-4000-8000-0000000086a0','PR-86A-1','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086b1','in_progress'),
  ('00000000-0000-4000-8000-0000000086f2','00000000-0000-4000-8000-0000000086a0','PR-86B-1','00000000-0000-4000-8000-0000000086a2','00000000-0000-4000-8000-0000000086b2','in_progress')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests SET pickup_route_id = '00000000-0000-4000-8000-0000000086f1'
 WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-1';
UPDATE public.manifests SET pickup_route_id = '00000000-0000-4000-8000-0000000086f2'
 WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-2';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
SELECT '00000000-0000-4000-8000-0000000086a0',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-1'),
       pkg, lbl, 'verified', NOW()
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000086d1'::uuid,'CTN86A-1'),('00000000-0000-4000-8000-0000000086d2','CTN86A-2'),
    ('00000000-0000-4000-8000-0000000086d3','CTN86A-3'),('00000000-0000-4000-8000-0000000086d4','CTN86A-4'),
    ('00000000-0000-4000-8000-0000000086d6','CTN86A-6'),('00000000-0000-4000-8000-0000000086d7','CTN86A-7')
  ) v(pkg, lbl);

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at) VALUES
  ('00000000-0000-4000-8000-0000000086a0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND external_load_id = 'CARGA-86A-2'),
   '00000000-0000-4000-8000-0000000086d5','CTN86A-5','verified', NOW());

UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id IN ('00000000-0000-4000-8000-0000000086f1','00000000-0000-4000-8000-0000000086f2');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000086a1","operator_id":"00000000-0000-4000-8000-0000000086a0","role":"authenticated"}', true);

-- d1 received on f1's own reception. d3's 'received' scan on f1 is
-- soft-deleted right after (mutation guard rs.deleted_at IS NULL). d6's
-- 'received' scan is attached to f2's reception, NOT f1's (mutation guard
-- rs.reception_id = v_rr.id: a package expected on f1, but physically
-- unloaded and scanned under f2 — arrived on another truck — must not count
-- as received on f1). d7 is scanned on f1's OWN reception but as
-- 'route_mismatch' (mutation guard rs.scan_result = 'received'). d5 received
-- in full on f2.
INSERT INTO public.reception_scans (id, reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at) VALUES
  ('00000000-0000-4000-8000-0000000086aa', (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'), '00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-1','received', NOW()),
  ('00000000-0000-4000-8000-0000000086ab', (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'), '00000000-0000-4000-8000-0000000086d3','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-3','received', NOW()),
  ('00000000-0000-4000-8000-0000000086ac', (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2'), '00000000-0000-4000-8000-0000000086d6','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-6','received', NOW()),
  ('00000000-0000-4000-8000-0000000086ad', (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'), '00000000-0000-4000-8000-0000000086d7','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-7','route_mismatch', NOW()),
  ('00000000-0000-4000-8000-0000000086ae', (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2'), '00000000-0000-4000-8000-0000000086d5','00000000-0000-4000-8000-0000000086a0','00000000-0000-4000-8000-0000000086a1','CTN86A-5','received', NOW());

UPDATE public.reception_scans SET deleted_at = NOW() WHERE id = '00000000-0000-4000-8000-0000000086ab';

-- ── 1. Closing short with a reason for d2 AND a malformed entry (regression
--       guard: a non-UUID package_id must not abort the close, 22P02) ─────
SELECT lives_ok(
  $$ SELECT public.complete_route_reception(
       '00000000-0000-4000-8000-0000000086f1'::uuid, 'Ruta llegó incompleta',
       jsonb_build_array(
         jsonb_build_object('package_id', '00000000-0000-4000-8000-0000000086d2', 'note', 'El local no lo entregó.'),
         jsonb_build_object('package_id', 'not-a-uuid', 'note', 'debe ignorarse en silencio')
       )
     ) $$,
  'closing short with a valid reason plus a malformed package_id does not raise'
);

SELECT is((SELECT status::text FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1'), 'completed', 'route_reception completed even though it closed short');

SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND operation_type = 'reception' AND route_reception_id = (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1') AND deleted_at IS NULL),
  4, 'exactly 4 open discrepancies on f1: d2, d3, d6, d7 (d1 received, d4 soft-deleted)'
);

SELECT is((SELECT (kind::text, status::text) FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d2' AND deleted_at IS NULL), ('missing'::text,'open'::text), 'd2 (never scanned) is an open missing discrepancy');
SELECT is((SELECT note FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d2' AND deleted_at IS NULL), 'El local no lo entregó.', 'd2 carries the reason the client sent');
SELECT is((SELECT note FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d3' AND deleted_at IS NULL), NULL, 'd3 (soft-deleted received scan) still opened, NULL note -- respaldo automático');
SELECT is((SELECT COUNT(*)::int FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d4' AND deleted_at IS NULL), 0, 'd4 (package itself soft-deleted) never recorded as missing');
SELECT is((SELECT COUNT(*)::int FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d1' AND deleted_at IS NULL), 0, 'd1 (received on f1) never recorded as missing');

-- Cross-route and route_mismatch guards.
SELECT is((SELECT (kind::text, status::text) FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d6' AND deleted_at IS NULL), ('missing'::text,'open'::text), 'd6 (received on f2, not f1) still counts as missing on f1 -- rs.reception_id guard');
SELECT is((SELECT (kind::text, status::text) FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d7' AND deleted_at IS NULL), ('missing'::text,'open'::text), 'd7 (route_mismatch, not received) still counts as missing -- rs.scan_result guard');

-- ── 2. A clean close (f2, received >= expected) does not fail ─────────────
SELECT lives_ok($$ SELECT public.complete_route_reception('00000000-0000-4000-8000-0000000086f2'::uuid) $$, 'closing f2 (received >= expected, empty p_items, spec-85 M5) does not raise');
SELECT is((SELECT status::text FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2'), 'completed', 'the clean close still completes f2');
SELECT is((SELECT COUNT(*)::int FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND route_reception_id = (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f2') AND deleted_at IS NULL), 0, 'f2 (its own package d5 received) has no discrepancies of its own');

-- ── 3. operator_id scoping: another tenant cannot complete f2 ─────────────
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000086b9","operator_id":"00000000-0000-4000-8000-0000000086b0","role":"authenticated"}', true);
SELECT throws_ok($$ SELECT public.complete_route_reception('00000000-0000-4000-8000-0000000086f2'::uuid) $$, 'route_reception for route 00000000-0000-4000-8000-0000000086f2 not found', 'another operator cannot complete a route_reception it does not own');

-- ── 4. Re-closing an already-completed route_reception must not resurrect a
--       resolved discrepancy (ronda 2 de review, #704) ───────────────────
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000086a1","operator_id":"00000000-0000-4000-8000-0000000086a0","role":"authenticated"}', true);

SELECT is(
  (SELECT status::text FROM public.resolve_discrepancy((SELECT id FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d2' AND deleted_at IS NULL), 'resolved', 'apareció en el andén')),
  'resolved', 'd2''s discrepancy is resolved by a human before any re-close attempt'
);

SELECT throws_ok(
  $$ SELECT public.complete_route_reception('00000000-0000-4000-8000-0000000086f1'::uuid, 'reintento') $$,
  'ROUTE_RECEPTION_ALREADY_COMPLETED: route_reception ' || (SELECT id::text FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1') || ' is already completed -- re-closing it would resurrect discrepancies a human already resolved',
  're-closing f1 (already completed) is rejected before it could touch any discrepancy'
);

SELECT is((SELECT COUNT(*)::int FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND route_reception_id = (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000086f1') AND deleted_at IS NULL), 4, 'f1 still has exactly 4 discrepancies after the rejected re-close -- no duplicate was inserted');
SELECT is((SELECT status::text FROM public.discrepancies WHERE operator_id = '00000000-0000-4000-8000-0000000086a0' AND package_id = '00000000-0000-4000-8000-0000000086d2' AND deleted_at IS NULL), 'resolved', 'd2 stays resolved -- the rejected re-close did not reopen it');

SELECT * FROM finish();
ROLLBACK;
