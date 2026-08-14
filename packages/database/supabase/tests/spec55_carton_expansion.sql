-- pgTAP: spec-55 carton expansion — expand_carton / delete_minted_carton
--
-- Fixture: two operators (A does the real work, B proves tenant isolation).
-- Operator A has one order with a single package CTN001 (declared_box_count=1,
-- the retailer under-declared) sitting on a manifest of external_load_id
-- CARGA-55-1 with one other unrelated package, so total_packages starts at 2.

BEGIN;
SELECT plan(28);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('00000000-0000-4000-8000-000000005500', 'Spec55 Op A', 'spec55-op-a'),
  ('00000000-0000-4000-8000-000000005501', 'Spec55 Op B', 'spec55-op-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-000000005510',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-a@spec55.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000005500"}'::jsonb,
   '{"full_name":"Crew A"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-000000005511',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-b@spec55.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000005501"}'::jsonb,
   '{"full_name":"Crew B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-000000005510','00000000-0000-4000-8000-000000005500','crew-a@spec55.test','Crew A',ARRAY['pickup']),
  ('00000000-0000-4000-8000-000000005511','00000000-0000-4000-8000-000000005501','crew-b@spec55.test','Crew B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-000000005520','00000000-0000-4000-8000-000000005500',
   'ORD-55-1','Cliente 55','+56911111111','Calle 55','Santiago', CURRENT_DATE,
   'CARGA-55-1','Retailer 55','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-000000005530','00000000-0000-4000-8000-000000005501',
   'ORD-55-OTRO','Cliente 55B','+56922222222','Calle 55B','Santiago', CURRENT_DATE,
   'CARGA-55-B','Retailer 55B','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- CTN001 (under-declared parent) + one unrelated package on the same manifest.
INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status, declared_box_count)
VALUES
  ('00000000-0000-4000-8000-000000005540','00000000-0000-4000-8000-000000005500',
   '00000000-0000-4000-8000-000000005520','CTN001','[]'::jsonb,'{}'::jsonb,'ingresado', 1),
  ('00000000-0000-4000-8000-000000005541','00000000-0000-4000-8000-000000005500',
   '00000000-0000-4000-8000-000000005520','CTN002','[]'::jsonb,'{}'::jsonb,'ingresado', 1)
ON CONFLICT (id) DO NOTHING;

-- Operator B's package, used only for the cross-tenant test.
INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-000000005550','00000000-0000-4000-8000-000000005501',
   '00000000-0000-4000-8000-000000005530','CTN-B-1','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- 20260814000001's trg_ensure_manifest_for_order already created a manifests
-- row for CARGA-55-1 the moment the order above was inserted (id is not
-- predictable, so it is captured into a variable here rather than assumed).
-- Seed its total_packages to the pre-expansion count (2) to prove rule 7
-- actually recomputes it rather than leaving a stale value in place.
DO $$
DECLARE v_manifest_id UUID;
BEGIN
  SELECT id INTO v_manifest_id FROM public.manifests
   WHERE operator_id = '00000000-0000-4000-8000-000000005500'
     AND external_load_id = 'CARGA-55-1';

  IF v_manifest_id IS NULL THEN
    RAISE EXCEPTION 'fixture: expected trg_ensure_manifest_for_order to have created a manifests row';
  END IF;

  UPDATE public.manifests SET total_packages = 2 WHERE id = v_manifest_id;
END $$;

-- Act as operator A's crew member for every call below unless stated otherwise.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000005510","operator_id":"00000000-0000-4000-8000-000000005500","role":"authenticated"}',
  true
);

-- ── 1. Minting creates exactly N rows with correct label/parent_label/etc ────
SELECT is(
  (SELECT COUNT(*)::INT FROM public.expand_carton(
    '00000000-0000-4000-8000-000000005540'::uuid, 2, 'Producto de varias cajas'
  )),
  2,
  'expand_carton(CTN001, 2) mints exactly 2 rows'
);

SELECT is(
  (SELECT array_agg(label ORDER BY label)::text FROM public.packages
    WHERE parent_label = 'CTN001' AND deleted_at IS NULL),
  '{CTN001-2,CTN001-3}',
  'minted siblings are labelled CTN001-2 and CTN001-3'
);

SELECT is(
  (SELECT bool_and(is_generated_label) FROM public.packages WHERE parent_label = 'CTN001'),
  true,
  'every minted sibling has is_generated_label = true'
);

SELECT is(
  (SELECT array_agg(DISTINCT order_id)::text FROM public.packages WHERE parent_label = 'CTN001'),
  '{00000000-0000-4000-8000-000000005520}',
  'minted siblings copy the parent''s order_id'
);

SELECT is(
  (SELECT created_by_user_id FROM public.packages WHERE label = 'CTN001-2'),
  '00000000-0000-4000-8000-000000005510'::uuid,
  'created_by_user_id records the actor who minted the carton'
);

-- ── 2. declared_box_count / package_number updated on parent AND siblings ───
SELECT is(
  (SELECT declared_box_count FROM public.packages WHERE label = 'CTN001'),
  3,
  'parent declared_box_count updated to the new total (3)'
);

SELECT is(
  (SELECT package_number::text FROM public.packages WHERE label = 'CTN001'),
  '1 de 3',
  'parent package_number reads "1 de 3"'
);

SELECT is(
  (SELECT array_agg(package_number::text ORDER BY label) FROM public.packages WHERE parent_label = 'CTN001'),
  ARRAY['2 de 3','3 de 3'],
  'siblings package_number reflect their position and the new total'
);

SELECT is(
  (SELECT declared_box_count FROM public.packages WHERE label = 'CTN001-3'),
  3,
  'sibling declared_box_count also updated to the new total'
);

-- ── 3. Second expansion picks the next free suffix, no unique violation ─────
SELECT lives_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, 1, 'Retailer declaró de menos') $$,
  'a second expansion of the same carton does not raise a unique violation'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.packages WHERE label = 'CTN001-4'),
  1,
  'the second expansion picks the next free suffix (CTN001-4), not a reused one'
);

SELECT is(
  (SELECT declared_box_count FROM public.packages WHERE label = 'CTN001'),
  4,
  'a second expansion recomputes the total across the whole family (now 4)'
);

SELECT is(
  (SELECT package_number::text FROM public.packages WHERE label = 'CTN001-2'),
  '2 de 4',
  'earlier siblings keep their position but pick up the new denominator'
);

-- ── 4. Cross-operator call raises / cannot touch a foreign package ──────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000005511","operator_id":"00000000-0000-4000-8000-000000005501","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, 1, 'intento cruzado') $$,
  '42501',
  'package not found',
  'operator B cannot expand operator A''s carton'
);

SELECT is(
  (SELECT declared_box_count FROM public.packages WHERE label = 'CTN001'),
  4,
  'the cross-tenant attempt left operator A''s carton untouched'
);

-- Back to operator A's crew member.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000005510","operator_id":"00000000-0000-4000-8000-000000005500","role":"authenticated"}',
  true
);

-- ── 5. Rejects out-of-range p_additional_boxes ───────────────────────────────
SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, 0, 'motivo') $$,
  'P0001',
  'p_additional_boxes must be between 1 and 20, got 0',
  'rejects p_additional_boxes = 0'
);

SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, -1, 'motivo') $$,
  'P0001',
  'p_additional_boxes must be between 1 and 20, got -1',
  'rejects a negative p_additional_boxes'
);

SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, 21, 'motivo') $$,
  'P0001',
  'p_additional_boxes must be between 1 and 20, got 21',
  'rejects p_additional_boxes = 21 (over the ceiling)'
);

-- ── 6. Rejects an empty reason ───────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, 1, '') $$,
  'P0001',
  'reason is required',
  'rejects an empty reason'
);

SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005540'::uuid, 1, '   ') $$,
  'P0001',
  'reason is required',
  'rejects a whitespace-only reason'
);

-- ── 7. Rejects a parent past verificado ──────────────────────────────────────
UPDATE public.packages SET status = 'en_bodega'
 WHERE label = 'CTN002' AND operator_id = '00000000-0000-4000-8000-000000005500';

SELECT throws_ok(
  $$ SELECT public.expand_carton('00000000-0000-4000-8000-000000005541'::uuid, 1, 'motivo') $$,
  'P0001',
  'cannot expand a carton once it has moved past verificado (current status: en_bodega)',
  'rejects expansion of a carton already past verificado (en_bodega)'
);

-- ── 8. manifests.total_packages reflects the new count ──────────────────────
-- Family is now CTN001 + 3 minted siblings (4) + CTN002 (1) = 5.
SELECT is(
  (SELECT total_packages FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000005500'
      AND external_load_id = 'CARGA-55-1'),
  5,
  'manifests.total_packages is recomputed after expansion'
);

-- ── 9. An audit row is written with the actor and reason ────────────────────
SELECT is(
  (SELECT COUNT(*)::INT FROM public.carton_expansion_audit
    WHERE operator_id = '00000000-0000-4000-8000-000000005500'
      AND actor_user_id = '00000000-0000-4000-8000-000000005510'
      AND parent_label = 'CTN001'
      AND reason = 'Producto de varias cajas'),
  1,
  'carton_expansion_audit records the actor and reason for the first expansion'
);

-- ── 10. A minted carton reaching a pickup scan is promoted to verificado ────
-- Proves the core design claim: a minted carton is an ordinary packages row
-- riding the spec-52 state engine exactly like any other.
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES (
  '00000000-0000-4000-8000-000000005500',
  (SELECT id FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000005500'
      AND external_load_id = 'CARGA-55-1'),
  (SELECT id FROM public.packages WHERE label = 'CTN001-2'),
  'CTN001-2','verified', NOW()
);

SELECT is(
  (SELECT status::text FROM public.packages WHERE label = 'CTN001-2'),
  'verificado',
  'a pickup scan on a minted carton promotes it to verificado via the existing state-engine trigger'
);

-- ── 11. delete_minted_carton — undo, shipped alongside expand_carton ────────
-- CTN001-4 is still 'ingresado' (never scanned), so it is eligible for undo.
DO $$
DECLARE v_sibling_id UUID;
BEGIN
  SELECT id INTO v_sibling_id FROM public.packages WHERE label = 'CTN001-4';
  PERFORM public.delete_minted_carton(v_sibling_id, 'creado por error');
END $$;

SELECT is(
  (SELECT deleted_at IS NOT NULL FROM public.packages WHERE label = 'CTN001-4'),
  true,
  'delete_minted_carton soft-deletes the sibling'
);

SELECT is(
  (SELECT declared_box_count FROM public.packages WHERE label = 'CTN001'),
  3,
  'delete_minted_carton recomputes the family total back down (4 -> 3)'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.carton_expansion_audit
    WHERE parent_label = 'CTN001' AND boxes_added = -1 AND reason = 'creado por error'),
  1,
  'delete_minted_carton writes an audit row with boxes_added = -1'
);

SELECT throws_ok(
  $$ SELECT public.delete_minted_carton('00000000-0000-4000-8000-000000005540'::uuid, 'no se puede') $$,
  'P0001',
  'the parent carton cannot be deleted, only a minted sibling',
  'delete_minted_carton refuses to delete the parent carton'
);

SELECT * FROM finish();
ROLLBACK;
