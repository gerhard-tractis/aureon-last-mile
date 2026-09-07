-- pgTAP: spec-80 fase 1 — close_manifest(p_manifest_id, p_signatures)
--
-- Fixture: two operators (A does the real work, B proves tenant isolation).
-- Operator A has one manifest in_progress on external_load_id CARGA-80-1,
-- with one order carrying two packages: one verified via pickup_scans, one
-- never scanned (so verified=1, missing=1 in the returned summary), plus one
-- pickup_scans row with scan_result='not_found' (unexpected=1).

BEGIN;
SELECT plan(12);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('00000000-0000-4000-8000-000000008000', 'Spec80 Op A', 'spec80-op-a'),
  ('00000000-0000-4000-8000-000000008001', 'Spec80 Op B', 'spec80-op-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-000000008010',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-a@spec80.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000008000"}'::jsonb,
   '{"full_name":"Crew A"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-000000008011',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-b@spec80.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000008001"}'::jsonb,
   '{"full_name":"Crew B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008000','crew-a@spec80.test','Crew A',ARRAY['pickup']),
  ('00000000-0000-4000-8000-000000008011','00000000-0000-4000-8000-000000008001','crew-b@spec80.test','Crew B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-000000008020','00000000-0000-4000-8000-000000008000',
   'ORD-80-1','Cliente 80','+56911111111','Calle 80','Santiago', CURRENT_DATE,
   'CARGA-80-1','Retailer 80','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-000000008030','00000000-0000-4000-8000-000000008001',
   'ORD-80-OTRO','Cliente 80B','+56922222222','Calle 80B','Santiago', CURRENT_DATE,
   'CARGA-80-B','Retailer 80B','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-000000008040','00000000-0000-4000-8000-000000008000',
   '00000000-0000-4000-8000-000000008020','CTN80-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-000000008041','00000000-0000-4000-8000-000000008000',
   '00000000-0000-4000-8000-000000008020','CTN80-2','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- Operator B's own manifest/order, used only for the cross-tenant test.
INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-000000008050','00000000-0000-4000-8000-000000008001',
   '00000000-0000-4000-8000-000000008030','CTN-B-1','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- 20260814000001's trg_ensure_manifest_for_order already created a manifests
-- row for CARGA-80-1 the moment the order above was inserted (id is not
-- predictable). Capture it and move it to in_progress, as the scan flow would.
DO $$
DECLARE v_manifest_id UUID;
BEGIN
  SELECT id INTO v_manifest_id FROM public.manifests
   WHERE operator_id = '00000000-0000-4000-8000-000000008000'
     AND external_load_id = 'CARGA-80-1';

  IF v_manifest_id IS NULL THEN
    RAISE EXCEPTION 'fixture: expected trg_ensure_manifest_for_order to have created a manifests row';
  END IF;

  UPDATE public.manifests
     SET status = 'in_progress', started_at = NOW()
   WHERE id = v_manifest_id;
END $$;

-- One verified scan (CTN80-1), CTN80-2 stays unscanned (missing), and one
-- not_found scan (a barcode not on the manifest at all — "unexpected").
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('00000000-0000-4000-8000-000000008000',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
   '00000000-0000-4000-8000-000000008040', 'CTN80-1', 'verified', NOW()),
  ('00000000-0000-4000-8000-000000008000',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
   NULL, 'CTN-AJENO-1', 'not_found', NOW());

-- Act as operator A's crew member for every call below unless stated otherwise.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000008010","operator_id":"00000000-0000-4000-8000-000000008000","role":"authenticated"}',
  true
);

-- ── 1. Rejects missing operator signature ───────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{}'::jsonb
     ) $$,
  'P0001',
  'operator signature is required',
  'close_manifest rejects a call with no operator signature'
);

SELECT is(
  (SELECT status::text FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  'in_progress',
  'the rejected call left the manifest untouched'
);

-- ── 2. Cross-tenant: operator B cannot close operator A's manifest ─────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000008011","operator_id":"00000000-0000-4000-8000-000000008001","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{"operator_signature":"data:image/png;base64,DDD","operator_name":"Crew B"}'::jsonb
     ) $$,
  '42501',
  'manifest not found',
  'operator B cannot close operator A''s manifest'
);

SELECT is(
  (SELECT status::text FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  'in_progress',
  'the cross-tenant attempt left operator A''s manifest untouched'
);

-- Back to operator A's crew member for the happy path.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000008010","operator_id":"00000000-0000-4000-8000-000000008000","role":"authenticated"}',
  true
);

-- ── 3. Happy close: operator signature present, client signature optional ──
SELECT is(
  (SELECT (out_verified_count, out_missing_count, out_unexpected_count)
     FROM public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{"operator_signature":"data:image/png;base64,AAA","operator_name":"Crew A"}'::jsonb
     )),
  (1, 1, 1),
  'close_manifest returns verified=1, missing=1, unexpected=1'
);

SELECT is(
  (SELECT status::text FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  'completed',
  'close_manifest sets status = completed'
);

SELECT is(
  (SELECT completed_at IS NOT NULL FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  true,
  'close_manifest sets completed_at'
);

SELECT is(
  (SELECT signature_operator FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  'data:image/png;base64,AAA',
  'close_manifest writes signature_operator'
);

SELECT is(
  (SELECT signature_operator_name FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  'Crew A',
  'close_manifest writes signature_operator_name'
);

SELECT is(
  (SELECT signature_client FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  NULL,
  'close_manifest leaves signature_client NULL when the client signature was not provided'
);

-- ── 4. Optional client signature is written when provided ──────────────────
-- Reopen a second manifest (fresh order/load) to test the client-signature
-- path without re-closing an already-completed one.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES (
  '00000000-0000-4000-8000-000000008021','00000000-0000-4000-8000-000000008000',
  'ORD-80-2','Cliente 80','+56911111111','Calle 80','Santiago', CURRENT_DATE,
  'CARGA-80-2','Retailer 80','{}'::jsonb,'MANUAL', NOW()
);

UPDATE public.manifests
   SET status = 'in_progress', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000008000'
   AND external_load_id = 'CARGA-80-2';

SELECT is(
  (SELECT out_signature_client FROM public.close_manifest(
    (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-2'),
    '{"operator_signature":"data:image/png;base64,EEE","operator_name":"Crew A","client_signature":"data:image/png;base64,ZZZ","client_name":"Local X"}'::jsonb
  )),
  'data:image/png;base64,ZZZ',
  'close_manifest writes signature_client when provided'
);

-- ── 5. Rejects a manifest that is already completed ─────────────────────────
SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{"operator_signature":"data:image/png;base64,CCC","operator_name":"Crew A"}'::jsonb
     ) $$,
  'P0001',
  'manifest already completed',
  'close_manifest rejects a manifest that is already completed'
);

SELECT * FROM finish();
ROLLBACK;
