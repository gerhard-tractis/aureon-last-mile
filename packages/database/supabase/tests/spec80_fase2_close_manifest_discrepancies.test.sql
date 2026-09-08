-- pgTAP: spec-80 fase 2 — close_manifest records discrepancies via
-- record_discrepancies (spec-85 fase 2), on close, in the same transaction.
--
-- Fixture: one operator, one manifest (CARGA-80B-1) with:
--   CTN80B-1 — scanned 'verified'                              -> not missing
--   CTN80B-2 — declared, never scanned, has a discrepancy_notes -> missing, WITH note
--   CTN80B-3 — declared, never scanned, a note exists but for a
--              DIFFERENT manifest (CARGA-80B-2)                 -> missing, NULL note
--              (mutation guard: sin `dn.manifest_id = v_manifest.id` esta
--              nota ajena se filtraría igual)
--   CTN80B-5 — declared, never scanned, its only note is
--              soft-deleted                                     -> missing, NULL note
--              (mutation guard: sin `dn.deleted_at IS NULL` esa nota
--              borrada se filtraría igual)
--   CTN80B-6 — declared, never scanned, but the PACKAGE ITSELF is
--              soft-deleted                                     -> NOT missing at all
--              (mutation guard: sin `p.deleted_at IS NULL` (en ambas
--              consultas) un bulto borrado contaría como faltante — choca
--              de frente con el no-negociable de soft deletes del repo)
--   'CTN-AJENO-1' scanned twice as 'not_found' (same barcode)   -> one unexpected
-- A second manifest (CARGA-80B-2), fully verified, 0 missing, 0 unexpected,
-- proves the empty-p_items path (spec-85's M5) does not fail the close.
BEGIN;
SELECT plan(13);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-0000000080b0', 'Spec80b Op A', 'spec80b-op-a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-0000000080b1',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-80b@spec80.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000080b0"}'::jsonb,
   '{"full_name":"Crew 80B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-0000000080b1','00000000-0000-4000-8000-0000000080b0','crew-80b@spec80.test','Crew 80B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-0000000080c0','00000000-0000-4000-8000-0000000080b0',
   'ORD-80B-1','Cliente 80B','+56911111111','Calle 80B','Santiago', CURRENT_DATE,
   'CARGA-80B-1','Retailer 80B','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080c1','00000000-0000-4000-8000-0000000080b0',
   'ORD-80B-2','Cliente 80B','+56911111111','Calle 80B','Santiago', CURRENT_DATE,
   'CARGA-80B-2','Retailer 80B','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-0000000080d0','00000000-0000-4000-8000-0000000080b0',
   '00000000-0000-4000-8000-0000000080c0','CTN80B-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000080d1','00000000-0000-4000-8000-0000000080b0',
   '00000000-0000-4000-8000-0000000080c0','CTN80B-2','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000080d2','00000000-0000-4000-8000-0000000080b0',
   '00000000-0000-4000-8000-0000000080c0','CTN80B-3','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000080d3','00000000-0000-4000-8000-0000000080b0',
   '00000000-0000-4000-8000-0000000080c1','CTN80B-4','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000080d5','00000000-0000-4000-8000-0000000080b0',
   '00000000-0000-4000-8000-0000000080c0','CTN80B-5','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-0000000080d6','00000000-0000-4000-8000-0000000080b0',
   '00000000-0000-4000-8000-0000000080c0','CTN80B-6','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- CTN80B-6: the package itself is soft-deleted. Mutation guard for
-- `p.deleted_at IS NULL` in BOTH the p_items query and the
-- v_missing_count query below — without it, a soft-deleted package would
-- still count and record as an open 'missing' discrepancy.
UPDATE public.packages
   SET deleted_at = NOW()
 WHERE id = '00000000-0000-4000-8000-0000000080d6';

-- 20260814000001's trg_ensure_manifest_for_order already created a manifests
-- row per load the moment its order was inserted (ids unpredictable).
UPDATE public.manifests
   SET status = 'in_progress', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
   AND external_load_id IN ('CARGA-80B-1', 'CARGA-80B-2');

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
   '00000000-0000-4000-8000-0000000080d0', 'CTN80B-1', 'verified', NOW()),
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
   NULL, 'CTN-AJENO-1', 'not_found', NOW()),
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
   NULL, 'CTN-AJENO-1', 'not_found', NOW()),
  -- CARGA-80B-2: fully verified, nothing missing, nothing unexpected.
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-2'),
   '00000000-0000-4000-8000-0000000080d3', 'CTN80B-4', 'verified', NOW());

-- CTN80B-2 has a note from the review screen (5e), for THIS manifest
-- (CARGA-80B-1). CTN80B-3's note below is for the OTHER manifest
-- (CARGA-80B-2) — same package_id column value doesn't apply here since
-- it's a different package, but the guard under test is `dn.manifest_id =
-- v_manifest.id`: without it, ANY note for that package_id would join in,
-- regardless of which manifest wrote it. CTN80B-5's note is soft-deleted.
INSERT INTO public.discrepancy_notes (operator_id, manifest_id, package_id, note, created_by_user_id, deleted_at)
VALUES
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
   '00000000-0000-4000-8000-0000000080d1', 'El local no lo encontró en bodega.',
   '00000000-0000-4000-8000-0000000080b1', NULL),
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-2'),
   '00000000-0000-4000-8000-0000000080d2', 'Nota de OTRO manifiesto — no debe aparecer en CARGA-80B-1.',
   '00000000-0000-4000-8000-0000000080b1', NULL),
  ('00000000-0000-4000-8000-0000000080b0',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
   '00000000-0000-4000-8000-0000000080d5', 'Nota BORRADA — no debe aparecer.',
   '00000000-0000-4000-8000-0000000080b1', NOW());

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000080b1","operator_id":"00000000-0000-4000-8000-0000000080b0","role":"authenticated"}',
  true
);

-- ── 1. Closing with gaps records exactly the right discrepancies ───────────
-- Missing: CTN80B-2, CTN80B-3, CTN80B-5 (CTN80B-6 is soft-deleted, excluded).
SELECT is(
  (SELECT (out_verified_count, out_missing_count, out_unexpected_count)
     FROM public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
       '{"operator_signature":"data:image/png;base64,AAA"}'::jsonb
     )),
  (1, 3, 1),
  'close_manifest still returns verified=1, missing=3, unexpected=1 (a soft-deleted declared package does not count)'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
      AND operation_type = 'pickup'
      AND manifest_id = (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1')
      AND deleted_at IS NULL),
  4,
  'close_manifest recorded 4 open discrepancies for this manifest (3 missing + 1 unexpected)'
);

SELECT is(
  (SELECT status::text FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND package_id = '00000000-0000-4000-8000-0000000080d1'
      AND kind = 'missing' AND deleted_at IS NULL),
  'open',
  'CTN80B-2 (missing, had a discrepancy_notes row) got an open missing discrepancy'
);

SELECT is(
  (SELECT note FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND package_id = '00000000-0000-4000-8000-0000000080d1'
      AND kind = 'missing' AND deleted_at IS NULL),
  'El local no lo encontró en bodega.',
  'the missing discrepancy carries the note the crew wrote on 5e'
);

-- Mutation guard: sin `dn.manifest_id = v_manifest.id` en el LEFT JOIN de
-- close_manifest, la nota de CARGA-80B-2 para este mismo package_id se
-- colaría aquí.
SELECT is(
  (SELECT note FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND package_id = '00000000-0000-4000-8000-0000000080d2'
      AND kind = 'missing' AND deleted_at IS NULL),
  NULL,
  'CTN80B-3 (missing, its only note belongs to a DIFFERENT manifest) gets recorded with a NULL note, not the other manifest''s note'
);

-- Mutation guard: sin `dn.deleted_at IS NULL`, la nota borrada de CTN80B-5
-- se colaría aquí en su lugar.
SELECT is(
  (SELECT note FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND package_id = '00000000-0000-4000-8000-0000000080d5'
      AND kind = 'missing' AND deleted_at IS NULL),
  NULL,
  'CTN80B-5 (missing, its only note is soft-deleted) gets recorded with a NULL note, not the deleted note'
);

-- Mutation guard: sin `p.deleted_at IS NULL` en la consulta de p_items Y en
-- v_missing_count, CTN80B-6 (soft-deleted) contaría y se registraría como
-- faltante — choca de frente con el no-negociable de soft deletes.
SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND package_id = '00000000-0000-4000-8000-0000000080d6'
      AND deleted_at IS NULL),
  0,
  'CTN80B-6 (the PACKAGE ITSELF is soft-deleted) is never recorded as missing'
);

SELECT is(
  (SELECT (barcode::text, status::text) FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND kind = 'unexpected'
      AND manifest_id = (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1')
      AND deleted_at IS NULL),
  ('CTN-AJENO-1'::text, 'open'::text),
  'the duplicated not_found scan produced exactly ONE open unexpected discrepancy, not two'
);

-- ── 2. Discrepancies are scoped to THIS manifest, not the operator at large ─
SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
      AND manifest_id = (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-2')
      AND deleted_at IS NULL),
  0,
  'CARGA-80B-2 (untouched so far) has no discrepancies of its own'
);

-- ── 3. A clean close (0 missing, 0 unexpected) does not fail ───────────────
-- spec-85's M5: record_discrepancies accepts an empty p_items and returns
-- the empty set rather than raising — this is the caller that fix exists for.
SELECT lives_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-2'),
       '{"operator_signature":"data:image/png;base64,BBB"}'::jsonb
     ) $$,
  'closing a manifest with 0 missing and 0 unexpected does not raise (empty p_items)'
);

SELECT is(
  (SELECT status::text FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-2'),
  'completed',
  'the clean close still completes the manifest'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.discrepancies
    WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
      AND manifest_id = (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-2')
      AND deleted_at IS NULL),
  0,
  'the clean close leaves 0 discrepancies for CARGA-80B-2 — an empty p_items records nothing'
);

-- ── 4. Idempotent: a rejected re-close attempt (already signed) does not
--    duplicate discrepancies — proven by the reject itself, not a second
--    successful call (close_manifest's own already-signed guard forbids
--    calling it twice on the same manifest; the duplicate-insert guard lives
--    in record_discrepancies and is covered by spec-85's own pgTAP suite).
SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-0000000080b0' AND external_load_id = 'CARGA-80B-1'),
       '{"operator_signature":"data:image/png;base64,CCC"}'::jsonb
     ) $$,
  '23505',
  'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature',
  're-closing an already-signed manifest is rejected before it could re-record any discrepancy'
);

SELECT * FROM finish();
ROLLBACK;
