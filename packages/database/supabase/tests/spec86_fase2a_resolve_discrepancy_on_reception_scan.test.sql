-- pgTAP: spec-86 fase 2a — el bulto aparece: un reception scan 'received'
-- resuelve la discrepancia 'reception' abierta que le corresponde, vía la
-- misma UPDATE que trg_reception_scan_advance_package_status ya hace para
-- avanzar el paquete a en_bodega (20260812000002). La resolución NO mueve el
-- estado del paquete por su cuenta: son dos UPDATE independientes en el mismo
-- trigger, no una encadenada a la otra.
--
-- PR-862A-1 (route f1, route_reception rr1), operator A:
--   d1 CTN862A-1 — open reception discrepancy on rr1  -> resolved by the scan
--   d2 CTN862A-2 — open reception discrepancy on rr2 (OTHER route_reception)
--                  -> scanned received on rr1, must stay open on rr2
--                  (mutation guard: route_reception_id = NEW.reception_id)
--   d3 CTN862A-3 — no discrepancy at all -> scan just advances the package
--   d4 CTN862A-4 — open PICKUP discrepancy (manifest, not route_reception)
--                  -> scanned received on rr1, must stay open. NOT a live
--                  mutation guard for "operation_type = 'reception'" — see
--                  the note below, it is kept as a readable positive case
--                  anyway (a pickup discrepancy really must stay untouched)
--   d5 CTN862A-5 — reception discrepancy already 'lost' on rr1
--                  -> scanned received on rr1, must NOT flip back to resolved
--                  (mutation guard: status = 'open')
--   d7 CTN862A-7 — open reception discrepancy on rr1, NEVER scanned
--                  -> stays open after d1 is scanned (mutation guard:
--                  package_id = NEW.package_id — without it, resolving d1
--                  would sweep every open discrepancy on rr1)
--   d8 CTN862A-8 — open reception discrepancy on rr1, soft-deleted directly
--                  (no code path produces this today, same as reception_scans.
--                  deleted_at in fase 1 — future-proofing, not reachable yet)
--                  -> scanned received on rr1, must stay open + deleted
--                  (mutation guard: deleted_at IS NULL)
-- PR-862B-1 (route f2, route_reception rr2) only exists to host d2's
-- discrepancy on a DIFFERENT source_id than rr1.
--
-- NOT mutation-tested here (declared, not covered — verified by actually
-- removing each predicate and re-running this file, not assumed):
--
-- * "operator_id = NEW.operator_id". Unlike packages (keyed only by id),
--   route_reception_id already uniquely determines the operator via its own
--   FK — a discrepancy row's route_reception_id cannot match NEW.reception_id
--   across two different operators, because NEW.reception_id itself belongs
--   to exactly one operator's route_reception. There is no reachable fixture
--   where route_reception_id matches and operator_id differs; kept anyway as
--   the same defense-in-depth resolve_discrepancy's "m1" note documents for
--   its own redundant operator_id check.
--
-- * "operation_type = 'reception'". Mutated and re-run against this exact
--   fixture set: survived 14/14 — d4 did NOT get resolved even with the
--   predicate removed. Root cause: discrepancy_source_matches_operation
--   (20260913000001) is a CHECK constraint, not a convention — a
--   'pickup' row can never have route_reception_id set (it is NULL by
--   construction), so it can never equal NEW.reception_id (always a real
--   route_reception, never NULL, whenever this branch runs) regardless of
--   this predicate. Same shape of redundancy as operator_id above, just
--   discovered by mutating instead of reasoned in advance — the schema, not
--   this predicate, is what actually keeps d4 safe. Left in the function
--   anyway: the CHECK constraint could change under a future migration, and
--   this predicate is the one that would then start doing real work.
BEGIN;
SELECT plan(14);

-- ── Fixtures ────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug) VALUES
  ('00000000-0000-4000-8000-0000000862a0','Spec862a Op A','spec862a-op-a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token) VALUES
  ('00000000-0000-4000-8000-0000000862a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-862a@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"00000000-0000-4000-8000-0000000862a0"}'::jsonb, '{"full_name":"Driver 862A"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-0000000862a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','driver-862a2@spec86.test', crypt('x', gen_salt('bf')), NOW(), '{"operator_id":"00000000-0000-4000-8000-0000000862a0"}'::jsonb, '{"full_name":"Driver 862A-2"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions) VALUES
  ('00000000-0000-4000-8000-0000000862a1','00000000-0000-4000-8000-0000000862a0','driver-862a@spec86.test','Driver 862A',ARRAY['pickup']),
  ('00000000-0000-4000-8000-0000000862a2','00000000-0000-4000-8000-0000000862a0','driver-862a2@spec86.test','Driver 862A-2',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('00000000-0000-4000-8000-0000000862b1','00000000-0000-4000-8000-0000000862a0','VEH-862A-1', true),
  ('00000000-0000-4000-8000-0000000862b2','00000000-0000-4000-8000-0000000862a0','VEH-862A-2', true)
ON CONFLICT DO NOTHING;

-- All packages hang off the same order/manifest (CARGA-862A-1), pickup-routed
-- onto f1, except nothing needs a second manifest — d2/d4's discrepancies are
-- attached to a DIFFERENT source (rr2 / a manifest) directly, not by routing
-- their package there.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, external_load_id, retailer_name, raw_data, imported_via, imported_at) VALUES
  ('00000000-0000-4000-8000-0000000862c0','00000000-0000-4000-8000-0000000862a0','ORD-862A-1','Cliente 862A','+56911111111','Calle 862A','Santiago', CURRENT_DATE, 'CARGA-862A-1','Retailer 862A','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status) VALUES
  ('00000000-0000-4000-8000-0000000862d1','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-1','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000862d2','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-2','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000862d3','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-3','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000862d4','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-4','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000862d5','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-5','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000862d7','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-7','[]'::jsonb,'{}'::jsonb,'verificado'),
  ('00000000-0000-4000-8000-0000000862d8','00000000-0000-4000-8000-0000000862a0','00000000-0000-4000-8000-0000000862c0','CTN862A-8','[]'::jsonb,'{}'::jsonb,'verificado')
ON CONFLICT (id) DO NOTHING;

-- Manifest auto-created by trg_ensure_manifest_for_order on the order INSERT.
UPDATE public.manifests SET status = 'completed', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-0000000862a0' AND external_load_id = 'CARGA-862A-1';

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('00000000-0000-4000-8000-0000000862f1','00000000-0000-4000-8000-0000000862a0','PR-862A-1','00000000-0000-4000-8000-0000000862a1','00000000-0000-4000-8000-0000000862b1','in_progress'),
  ('00000000-0000-4000-8000-0000000862f2','00000000-0000-4000-8000-0000000862a0','PR-862B-1','00000000-0000-4000-8000-0000000862a2','00000000-0000-4000-8000-0000000862b2','in_progress')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests SET pickup_route_id = '00000000-0000-4000-8000-0000000862f1'
 WHERE operator_id = '00000000-0000-4000-8000-0000000862a0' AND external_load_id = 'CARGA-862A-1';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
SELECT '00000000-0000-4000-8000-0000000862a0',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000862a0' AND external_load_id = 'CARGA-862A-1'),
       pkg, lbl, 'verified', NOW()
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000862d1'::uuid,'CTN862A-1'),('00000000-0000-4000-8000-0000000862d2','CTN862A-2'),
    ('00000000-0000-4000-8000-0000000862d3','CTN862A-3'),('00000000-0000-4000-8000-0000000862d4','CTN862A-4'),
    ('00000000-0000-4000-8000-0000000862d5','CTN862A-5'),('00000000-0000-4000-8000-0000000862d7','CTN862A-7'),
    ('00000000-0000-4000-8000-0000000862d8','CTN862A-8')
  ) v(pkg, lbl);

UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id IN ('00000000-0000-4000-8000-0000000862f1','00000000-0000-4000-8000-0000000862f2');

-- route_receptions rr1/rr2 now exist (spec-47 cascade). Capture them.
DO $$ BEGIN
  PERFORM 1;
END $$;

-- ── Discrepancy fixtures (written directly — this test targets the scan
--    trigger's resolution logic, not record_discrepancies) ────────────────
INSERT INTO public.discrepancies (
  id, operator_id, kind, operation_type, status, package_id,
  route_reception_id, detected_by_user_id, note
) VALUES
  -- d1: open, on rr1 -> the positive case.
  ('00000000-0000-4000-8000-0000000862e1','00000000-0000-4000-8000-0000000862a0','missing','reception','open',
   '00000000-0000-4000-8000-0000000862d1',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
   '00000000-0000-4000-8000-0000000862a1','no llegó'),
  -- d2: open, on rr2 (a DIFFERENT route_reception than the one d2 gets scanned on).
  ('00000000-0000-4000-8000-0000000862e2','00000000-0000-4000-8000-0000000862a0','missing','reception','open',
   '00000000-0000-4000-8000-0000000862d2',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f2'),
   '00000000-0000-4000-8000-0000000862a1','no llegó en f2'),
  -- d7: open, on rr1, whose package is NEVER scanned by this test.
  ('00000000-0000-4000-8000-0000000862e7','00000000-0000-4000-8000-0000000862a0','missing','reception','open',
   '00000000-0000-4000-8000-0000000862d7',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
   '00000000-0000-4000-8000-0000000862a1','tampoco llegó'),
  -- d8: open, on rr1, soft-deleted directly (no live code path today).
  ('00000000-0000-4000-8000-0000000862e8','00000000-0000-4000-8000-0000000862a0','missing','reception','open',
   '00000000-0000-4000-8000-0000000862d8',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
   '00000000-0000-4000-8000-0000000862a1','borrada')
ON CONFLICT DO NOTHING;

UPDATE public.discrepancies SET deleted_at = NOW() WHERE id = '00000000-0000-4000-8000-0000000862e8';

-- d5: 'lost' (terminal), on rr1 -- already resolved-with-a-verdict, so it
-- carries resolved_at/resolved_by_user_id/resolution like any other closed row.
INSERT INTO public.discrepancies (
  id, operator_id, kind, operation_type, status, package_id,
  route_reception_id, detected_by_user_id, note,
  resolution, resolved_at, resolved_by_user_id
) VALUES
  ('00000000-0000-4000-8000-0000000862e5','00000000-0000-4000-8000-0000000862a0','missing','reception','lost',
   '00000000-0000-4000-8000-0000000862d5',
   (SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
   '00000000-0000-4000-8000-0000000862a1','declarado perdido',
   'declarado perdido por el jefe de operaciones', NOW() - INTERVAL '1 day', '00000000-0000-4000-8000-0000000862a1')
ON CONFLICT DO NOTHING;

-- d4: a PICKUP discrepancy (manifest, not route_reception) for the same package.
INSERT INTO public.discrepancies (
  id, operator_id, kind, operation_type, status, package_id, manifest_id, detected_by_user_id, note
) VALUES
  ('00000000-0000-4000-8000-0000000862e4','00000000-0000-4000-8000-0000000862a0','missing','pickup','open',
   '00000000-0000-4000-8000-0000000862d4',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000862a0' AND external_load_id = 'CARGA-862A-1'),
   '00000000-0000-4000-8000-0000000862a1','faltó en recogida')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000862a1","operator_id":"00000000-0000-4000-8000-0000000862a0","role":"authenticated"}', true);

-- ── 1. The positive case: d1 scanned received on rr1 ───────────────────────
INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
        '00000000-0000-4000-8000-0000000862d1','00000000-0000-4000-8000-0000000862a0',
        '00000000-0000-4000-8000-0000000862a1','CTN862A-1','received', NOW());

SELECT is((SELECT status::text FROM public.packages WHERE id = '00000000-0000-4000-8000-0000000862d1'), 'en_bodega', 'd1 package still advances to en_bodega (pre-existing behaviour untouched)');
SELECT is((SELECT status::text FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e1'), 'resolved', 'd1''s open reception discrepancy is resolved by the scan');
SELECT isnt((SELECT resolution FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e1'), NULL, 'd1''s resolution text is not null -- resolve_discrepancy requires one, the auto-write must too');
SELECT isnt((SELECT resolved_at FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e1'), NULL, 'd1''s resolved_at is stamped');
SELECT is((SELECT resolved_by_user_id FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e1'), '00000000-0000-4000-8000-0000000862a1'::uuid, 'd1''s resolved_by_user_id is the scanning user');

-- ── 2. d2: scanned received on rr1, but its discrepancy lives on rr2 ───────
INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
        '00000000-0000-4000-8000-0000000862d2','00000000-0000-4000-8000-0000000862a0',
        '00000000-0000-4000-8000-0000000862a1','CTN862A-2','received', NOW());

SELECT is((SELECT status::text FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e2'), 'open', 'd2''s discrepancy on rr2 stays open -- scanned on the wrong route_reception (source_id guard)');

-- ── 3. d3: no discrepancy at all -- scan just works ─────────────────────────
SELECT lives_ok(
  $$ INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
     VALUES ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
             '00000000-0000-4000-8000-0000000862d3','00000000-0000-4000-8000-0000000862a0',
             '00000000-0000-4000-8000-0000000862a1','CTN862A-3','received', NOW()) $$,
  'scanning a package with no discrepancy at all does not raise'
);
SELECT is((SELECT status::text FROM public.packages WHERE id = '00000000-0000-4000-8000-0000000862d3'), 'en_bodega', 'd3 package still advances with no discrepancy in play');
SELECT is((SELECT COUNT(*)::int FROM public.discrepancies WHERE package_id = '00000000-0000-4000-8000-0000000862d3'), 0, 'd3 never had a discrepancy row -- none was created by the scan');

-- ── 4. d4: PICKUP discrepancy on the same package, must not be touched ─────
INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
        '00000000-0000-4000-8000-0000000862d4','00000000-0000-4000-8000-0000000862a0',
        '00000000-0000-4000-8000-0000000862a1','CTN862A-4','received', NOW());

SELECT is((SELECT status::text FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e4'), 'open', 'd4''s PICKUP discrepancy stays open -- a reception scan does not resolve pickup discrepancies (operation_type guard)');

-- ── 5. d5: already 'lost' -- must not be resurrected to 'resolved' ─────────
INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
        '00000000-0000-4000-8000-0000000862d5','00000000-0000-4000-8000-0000000862a0',
        '00000000-0000-4000-8000-0000000862a1','CTN862A-5','received', NOW());

SELECT is((SELECT status::text FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e5'), 'lost', 'd5 stays lost -- a closed discrepancy is evidence, the scan does not reopen or change it (status=open guard)');

-- ── 6. d7: never scanned -- must stay open after d1's scan (isolates package_id) ─
SELECT is((SELECT status::text FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e7'), 'open', 'd7 (never scanned) stays open -- resolving d1 does not sweep every open discrepancy on rr1');

-- ── 7. d8: soft-deleted -- scanning its package must not touch it ──────────
INSERT INTO public.reception_scans (reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
VALUES ((SELECT id FROM public.route_receptions WHERE pickup_route_id = '00000000-0000-4000-8000-0000000862f1'),
        '00000000-0000-4000-8000-0000000862d8','00000000-0000-4000-8000-0000000862a0',
        '00000000-0000-4000-8000-0000000862a1','CTN862A-8','received', NOW());

SELECT is((SELECT status::text FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e8'), 'open', 'd8 (soft-deleted) is untouched -- still open in the row itself');
SELECT isnt((SELECT deleted_at FROM public.discrepancies WHERE id = '00000000-0000-4000-8000-0000000862e8'), NULL, 'd8 stays soft-deleted');

SELECT * FROM finish();
ROLLBACK;
