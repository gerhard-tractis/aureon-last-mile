-- pgTAP: spec-83 fase 1 — get_completed_manifests() gains missing_count,
-- read from public.discrepancies (spec-85) instead of a second per-manifest
-- query. TodayClosuresPanel uses it to show "2 faltantes de 44" in warning
-- palette only when > 0.
--
-- Fixture:
--   CARGA-83-1 (44 packages) —
--     d1: kind='missing', status='open'    -> counts
--     d2: kind='missing', status='resolved' -> does NOT count (round-2
--         product decision: "si se resolvió ya no es merma")
--     d3: kind='unexpected', status='open' -> does NOT count (different
--         fact — surplus, not shortfall)
--     d4: kind='missing', deleted_at=NOW() -> does NOT count (soft-delete)
--     d5: kind='missing', status='lost'    -> COUNTS. This is the row that
--         distinguishes the correct filter (`status <> 'resolved'`) from
--         the wrong one an ops manager would otherwise silently launder
--         (`status = 'open'`) — 'lost' is the indemnity-workflow trigger
--         (20260913000005), not a statement that the shortfall un-happened.
--   CARGA-83-1 total missing_count = 2 (d1 + d5).
--
--   CARGA-83-2 (38 packages) — 0 discrepancies -> missing_count = 0 (cierre
--         limpio; TodayClosuresPanel no debe teñirlo de warning).
--
--   CARGA-83-3 (10 packages) — ONLY a 'lost' discrepancy, no 'open' one.
--         missing_count must be 1. This is the fixture that would catch a
--         regression back to `status = 'open'`: that wrong filter reports 0
--         here, painting a real loss as a clean close.
--
--   CARGA-83-4 (5 packages) — the SAME package_id has TWO non-resolved
--         discrepancy rows on the SAME manifest (one 'open', one 'lost') —
--         uniq_open_discrepancy_per_package only blocks two 'open' rows for
--         that pair, not an 'open' + 'lost' one (e.g. spec-81's offline
--         queue retries a close and records the 'open' row, then an ops
--         manager confirms the same loss as 'lost' before the first
--         resolves). missing_count must still be 1, not 2: COUNT(DISTINCT
--         package_id) collapses this pair into the single physical
--         shortfall it actually is — round-2 review reversed an earlier
--         "document, don't fix" call on this exact case, because the
--         overcounted figure can land in an indemnity dispute.
--
-- Also asserts labels_printed_at/labels_printed_by_name survive this
-- CREATE OR REPLACE with a REAL name, not just a NULL check — a NULL check
-- alone does not exercise the LEFT JOIN users at all (round-2 finding: the
-- migration's join can be replaced with a NULL literal and this test would
-- not notice).

BEGIN;
SELECT plan(6);

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
   'CARGA-83-2','Retailer 83','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000083c2','00000000-0000-4000-8000-0000000083f0',
   'ORD-83-3','Cliente 83','+56911111111','Calle 83','Santiago', CURRENT_DATE,
   'CARGA-83-3','Retailer 83','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000083c3','00000000-0000-4000-8000-0000000083f0',
   'ORD-83-4','Cliente 83','+56911111111','Calle 83','Santiago', CURRENT_DATE,
   'CARGA-83-4','Retailer 83','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-0000000083d0','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d1','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-2','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d2','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-3','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d3','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c0','CTN83-4','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d4','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c2','CTN83-5','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000083d5','00000000-0000-4000-8000-0000000083f0',
   '00000000-0000-4000-8000-0000000083c3','CTN83-6','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- 20260814000001's trg_ensure_manifest_for_order already created a manifests
-- row per load the moment its order was inserted (ids unpredictable).
-- CARGA-83-1 also carries a real label print, to kill a mutant that swaps
-- the LEFT JOIN users for a NULL literal (round-2 finding).
--
-- reception_status = 'received' on all four (spec-94 fase 1): get_completed_
-- manifests() no longer partitions on status='completed' alone -- see the
-- same note in spec80_fase2b_completed_manifests_signature.test.sql for why
-- reception_status IS NULL is not reachable here (trg_manifest_set_
-- reception_status, spec-08, auto-fills it the instant status transitions to
-- 'completed').
UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 44, total_orders = 1,
       labels_printed_at = NOW(), labels_printed_by = '00000000-0000-4000-8000-0000000083f1',
       reception_status = 'received'
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND external_load_id = 'CARGA-83-1';

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 38, total_orders = 1,
       reception_status = 'received'
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND external_load_id = 'CARGA-83-2';

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 10, total_orders = 1,
       reception_status = 'received'
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND external_load_id = 'CARGA-83-3';

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 5, total_orders = 1,
       reception_status = 'received'
 WHERE operator_id = '00000000-0000-4000-8000-0000000083f0'
   AND external_load_id = 'CARGA-83-4';

-- resolved_at is populated IN the INSERT (not via a later UPDATE) — the
-- discrepancy_resolved_has_when CHECK is immediate/non-deferrable, so a
-- resolved row without resolved_at in the SAME statement aborts the whole
-- multi-row INSERT (round-2 finding: the previous version of this fixture
-- set resolved_at via a follow-up UPDATE, which never ran because the
-- INSERT itself had already failed).
INSERT INTO public.discrepancies (
  operator_id, kind, operation_type, status, package_id, barcode, manifest_id,
  detected_by_user_id, resolved_at, resolved_by_user_id, resolution, deleted_at
) VALUES
  -- d1: open missing -> counts
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','open',
   '00000000-0000-4000-8000-0000000083d0', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NULL, NULL, NULL, NULL),
  -- d2: resolved missing -> does NOT count
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','resolved',
   '00000000-0000-4000-8000-0000000083d1', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NOW(), '00000000-0000-4000-8000-0000000083f1', 'Encontrado en bodega.', NULL),
  -- d3: unexpected -> must NOT count toward missing_count
  ('00000000-0000-4000-8000-0000000083f0','unexpected','pickup','open',
   NULL, 'CTN-AJENO-83',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NULL, NULL, NULL, NULL),
  -- d4: soft-deleted missing -> must NOT count
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','open',
   '00000000-0000-4000-8000-0000000083d2', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NULL, NULL, NULL, NOW()),
  -- d5: lost missing -> COUNTS (the row that distinguishes `<> 'resolved'`
  -- from a wrong `= 'open'` filter).
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','lost',
   '00000000-0000-4000-8000-0000000083d3', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-1'),
   '00000000-0000-4000-8000-0000000083f1', NOW(), '00000000-0000-4000-8000-0000000083f1', 'Confirmado perdido, indemnizar.', NULL),
  -- CARGA-83-3: ONLY a 'lost' row, no 'open' one. Kills a regression to
  -- `status = 'open'`, which would report 0 here.
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','lost',
   '00000000-0000-4000-8000-0000000083d4', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-3'),
   '00000000-0000-4000-8000-0000000083f1', NOW(), '00000000-0000-4000-8000-0000000083f1', 'Confirmado perdido.', NULL),
  -- CARGA-83-4: SAME package_id, SAME manifest, two non-resolved rows
  -- ('open' + 'lost') — must still count as ONE shortfall, not two.
  -- uniq_open_discrepancy_per_package only blocks two 'open' rows for the
  -- same (package_id, source_id), not an 'open' + 'lost' pair, so
  -- COUNT(DISTINCT package_id) is what actually collapses this.
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','open',
   '00000000-0000-4000-8000-0000000083d5', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-4'),
   '00000000-0000-4000-8000-0000000083f1', NULL, NULL, NULL, NULL),
  ('00000000-0000-4000-8000-0000000083f0','missing','pickup','lost',
   '00000000-0000-4000-8000-0000000083d5', NULL,
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000083f0' AND external_load_id = 'CARGA-83-4'),
   '00000000-0000-4000-8000-0000000083f1', NOW(), '00000000-0000-4000-8000-0000000083f1', 'Confirmado perdido tras un reintento.', NULL);

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
  'CARGA-83-1: 2 missing discrepancies counted (open + lost); resolved, unexpected and soft-deleted excluded'
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

-- The fixture that distinguishes the correct filter (`status <> 'resolved'`)
-- from the wrong one (`status = 'open'`): CARGA-83-3 has ONLY a 'lost' row.
-- `= 'open'` would report 0 here — a real, ops-manager-confirmed loss
-- painted as a clean close.
SELECT is(
  (SELECT missing_count FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-83-3'),
  1,
  'CARGA-83-3: a lone ''lost'' discrepancy still counts as missing — ''lost'' is not ''resolved'''
);

-- The same physical shortfall recorded twice (one 'open' row, one 'lost'
-- row, same package_id, same manifest) must still count as ONE — proves
-- COUNT(DISTINCT package_id), not a plain row count.
SELECT is(
  (SELECT missing_count FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-83-4'),
  1,
  'CARGA-83-4: the same package with an open row AND a lost row counts as 1 shortfall, not 2 (COUNT DISTINCT package_id)'
);

-- spec-53 contract: labels_printed_at/labels_printed_by_name must survive
-- this CREATE OR REPLACE with a REAL value — asserting only "IS NULL" does
-- not exercise the LEFT JOIN users at all (round-2 finding: swapping
-- `u.full_name AS labels_printed_by_name` for `NULL::TEXT` left the old
-- version of this test green).
SELECT is(
  (SELECT (labels_printed_at IS NOT NULL, labels_printed_by_name)
     FROM public.get_completed_manifests() WHERE external_load_id = 'CARGA-83-1'),
  (true, 'Crew 83'::text),
  'labels_printed_at/labels_printed_by_name survive this CREATE OR REPLACE with the REAL printer name (spec-53 contract)'
);

SELECT * FROM finish();
ROLLBACK;
