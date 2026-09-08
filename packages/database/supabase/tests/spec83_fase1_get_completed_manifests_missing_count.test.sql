-- pgTAP: spec-83 fase 1 — get_completed_manifests() gains missing_count,
-- read from public.discrepancies (spec-85) instead of a second per-manifest
-- query. TodayClosuresPanel uses it to show "2 faltantes de 44" in warning
-- palette only when > 0.
--
-- Fixture: one operator, two completed manifests:
--   CARGA-83-1 (44 packages) — has discrepancies:
--     d1: kind='missing', operation_type='pickup', status='open'   -> counts
--     d2: kind='missing', operation_type='pickup', status='resolved' -> counts
--         (mutation guard: sin esto, filtrar por status='open' dejaría la
--         merma histórica en 1 en vez de 2 una vez alguien resuelve una)
--     d3: kind='unexpected', operation_type='pickup', status='open' -> NO
--         cuenta (mutation guard: sin el filtro kind='missing', el sobrante
--         se sumaría a la merma, que son dos hechos distintos)
--     d4: kind='missing', operation_type='pickup', deleted_at=NOW() -> NO
--         cuenta (mutation guard: soft-delete no negociable)
--   CARGA-83-2 (38 packages) — 0 discrepancies -> missing_count = 0 (cierre
--         limpio; TodayClosuresPanel no debe teñirlo de warning)
--
-- Also asserts labels_printed_at/labels_printed_by_name survive this
-- CREATE OR REPLACE (spec-53's contract; the 2026-09-08 note on this spec
-- flags exactly this as the trap of templating off the wrong migration).

BEGIN;
SELECT plan(5);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-0000000083f0', 'Spec83 Op A', 'spec83-op-a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-0000000083f1',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-83@spec83.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000083f0"}'::jsonb,
   '{"full_name":"Crew 83"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-0000000083f1','00000000-0000-4000-8000-0000000083f0','crew-83@spec83.test','Crew 83',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-0000000083c0','00000000-0000-4000-8000-0000000083f0',
   'ORD-83-1','Cliente 83','+56911111111','Calle 83','Santiago', CURRENT_DATE,
   'CARGA-83-1','Retailer 83','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000083c1','00000000-0000-4000-8000-0000000083f0',
   'ORD-83-2','Cliente 83','+56911111111','Calle 83','Santiago', CURRENT_DATE,
   'CARGA-83-2','Retailer 83','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-0000000083d0','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d1','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-2','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d2','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-3','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- 20260814000001's trg_ensure_manifest_for_order already created a manifests
-- row per load the moment its order was inserted (ids unpredictable).
UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 44, total_orders = 1
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND external_load_id = 'CARGA-83-1';

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 38, total_orders = 1
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND external_load_id = 'CARGA-83-2';

INSERT INTO public.discrepancies (
  operator_id, kind, operation_type, status, package_id, barcode, manifest_id,
  detected_by_user_id, deleted_at
) VALUES
  -- d1: open missing -> counts
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','open',
   '00000000-0000-4000-8000-0000000083d0', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NULL),
  -- d2: resolved missing -> still counts (merma histórica no depende del estado)
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','resolved',
   '00000000-0000-4000-8000-0000000083d1', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NULL),
  -- d3: unexpected -> must NOT count toward missing_count
  ('00000000-0000-4000-8000-0000000083f0','unexpected','pickup','open',
   NULL, 'CTN-AJENO-83',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NULL),
  -- d4: soft-deleted missing -> must NOT count
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','open',
   '00000000-0000-4000-8000-0000000083d2', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NOW());

-- Resolved rows require resolved_at (discrepancy_resolved_has_when).
UPDATE public.discrepancies
   SET resolved_at = NOW(), resolved_by_user_id = '00000000-0000-4000-8000-0000000083f1', resolution = 'Encontrado en bodega.'
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND package_id = '00000000-0000-4000-8000-0000000083d1'
   AND status = 'resolved';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000083f1","operator_id":"00000000-0000-4000-8000-0000000083f0","role":"authenticated"}',
  true
);

-- ── Assertions ───────────────────────────────────────────────────────────────
SELECT is(
  (SELECT missing_count FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-83-1'),
  2,
  'CARGA-83-1: 2 missing discrepancies counted (1 open + 1 resolved), unexpected and soft-deleted excluded'
);

SELECT is(
  (SELECT missing_count FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-83-2'),
  0,
  'CARGA-83-2: clean close, 0 missing'
);

SELECT is(
  (SELECT total_packages FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-83-1'),
  44,
  'CARGA-83-1 still reports total_packages=44 (contract unchanged)'
);

-- Mutation guard: without `kind = 'missing'` in the subquery, d3 (unexpected)
-- would inflate CARGA-83-1's count to 3.
SELECT isnt(
  (SELECT missing_count FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-83-1'),
  3,
  'the unexpected discrepancy (d3) is not counted as missing'
);

-- spec-53 contract: labels_printed_at/labels_printed_by_name must survive
-- this CREATE OR REPLACE (the trap this spec's 2026-09-08 note documents —
-- templating off 20260428000001 instead of 20260813000001 would drop these
-- columns; referencing them here fails loudly at parse time if they are
-- missing, rather than silently passing).
SELECT is(
  (SELECT (labels_printed_at IS NULL, labels_printed_by_name IS NULL)
     FROM public.get_completed_manifests() WHERE external_load_id = 'CARGA-83-1'),
  (true, true),
  'labels_printed_at/labels_printed_by_name columns survive this CREATE OR REPLACE (spec-53 contract) — both NULL since no print job was dispatched in this fixture'
);

SELECT * FROM finish();
ROLLBACK;
