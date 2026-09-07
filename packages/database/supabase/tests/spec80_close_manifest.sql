-- pgTAP: spec-80 fase 1 — close_manifest(p_manifest_id, p_signatures)
--
-- Fixture: two operators (A does the real work, B proves tenant isolation).
-- Operator A has manifests on four loads:
--   CARGA-80-1 — the happy path: one verified scan, one unscanned package
--     (missing), and a duplicate not_found scan of the SAME foreign barcode
--     (proves unexpected_count dedupes by barcode, not by scan row).
--   CARGA-80-2 — used only for the optional client-signature path.
--   CARGA-80-3 — simulates the OTHER closer: trg_route_receptions_status_sync
--     (20260812000006) forces status='completed' with no signature when a
--     hub reception finishes. Proves close_manifest can still rescue the
--     signature onto an unsigned-but-completed manifest, and that doing so
--     does not clobber the completed_at the trigger already set.
--   CARGA-80-4 — simulates remove_manifest_from_route (20260824000004),
--     which returns a manifest to 'pending' with started_at NULL. Proves
--     close_manifest refuses to sign a manifest that was never actually
--     worked (as opposed to one that finished through the other closer).

BEGIN;
SELECT plan(21);

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

-- full_name is what close_manifest must read for signature_operator_name —
-- an attacker-controlled p_signatures.operator_name must be ignored (H5).
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
  ('00000000-0000-4000-8000-000000008021','00000000-0000-4000-8000-000000008000',
   'ORD-80-2','Cliente 80','+56911111111','Calle 80','Santiago', CURRENT_DATE,
   'CARGA-80-2','Retailer 80','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-000000008022','00000000-0000-4000-8000-000000008000',
   'ORD-80-3','Cliente 80','+56911111111','Calle 80','Santiago', CURRENT_DATE,
   'CARGA-80-3','Retailer 80','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-000000008023','00000000-0000-4000-8000-000000008000',
   'ORD-80-4','Cliente 80','+56911111111','Calle 80','Santiago', CURRENT_DATE,
   'CARGA-80-4','Retailer 80','{}'::jsonb,'MANUAL', NOW()),
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
-- row for each load the moment its order was inserted (ids not predictable).
UPDATE public.manifests
   SET status = 'in_progress', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000008000'
   AND external_load_id IN ('CARGA-80-1', 'CARGA-80-2');

-- CARGA-80-3: the OTHER closer already ran (route reception finished the
-- hub side) and left the manifest completed with no signature at all.
UPDATE public.manifests
   SET status = 'completed', started_at = NOW() - INTERVAL '2 hours',
       completed_at = NOW() - INTERVAL '1 hour'
 WHERE operator_id = '00000000-0000-4000-8000-000000008000'
   AND external_load_id = 'CARGA-80-3';

-- CARGA-80-4: remove_manifest_from_route already ran — back to pending,
-- never started.
UPDATE public.manifests
   SET status = 'pending', started_at = NULL, completed_at = NULL
 WHERE operator_id = '00000000-0000-4000-8000-000000008000'
   AND external_load_id = 'CARGA-80-4';

-- One verified scan (CTN80-1), CTN80-2 stays unscanned (missing), and a
-- DUPLICATE not_found scan of the same foreign barcode (crew retried after
-- the reject beep) — must count as ONE unexpected package, not two.
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('00000000-0000-4000-8000-000000008000',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
   '00000000-0000-4000-8000-000000008040', 'CTN80-1', 'verified', NOW()),
  ('00000000-0000-4000-8000-000000008000',
   (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
   NULL, 'CTN-AJENO-1', 'not_found', NOW()),
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
       '{"operator_signature":"data:image/png;base64,DDD"}'::jsonb
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

-- ── 3. No JWT at all ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);

SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{"operator_signature":"data:image/png;base64,DDD"}'::jsonb
     ) $$,
  '42501',
  'no operator in JWT',
  'close_manifest rejects a call with no operator_id claim at all'
);

-- Back to operator A's crew member for the happy path.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000008010","operator_id":"00000000-0000-4000-8000-000000008000","role":"authenticated"}',
  true
);

-- ── 4. Happy close: operator signature present, client signature optional ──
-- H5: p_signatures.operator_name is a spoof attempt — must be ignored in
-- favour of the JWT-derived actor's public.users.full_name.
SELECT is(
  (SELECT (out_verified_count, out_missing_count, out_unexpected_count)
     FROM public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{"operator_signature":"data:image/png;base64,AAA","operator_name":"SPOOFED NAME"}'::jsonb
     )),
  (1, 1, 1),
  'close_manifest returns verified=1, missing=1, unexpected=1 (duplicate not_found barcode deduped)'
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
  'close_manifest derives signature_operator_name from public.users, ignoring the spoofed p_signatures.operator_name'
);

SELECT is(
  (SELECT signature_client FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
  NULL,
  'close_manifest leaves signature_client NULL when the client signature was not provided'
);

-- ── 5. Optional client signature + name are both written when provided ─────
UPDATE public.manifests
   SET status = 'in_progress', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000008000'
   AND external_load_id = 'CARGA-80-2';

SELECT is(
  (SELECT out_signature_client FROM public.close_manifest(
    (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-2'),
    '{"operator_signature":"data:image/png;base64,EEE","client_signature":"data:image/png;base64,ZZZ","client_name":"Local X"}'::jsonb
  )),
  'data:image/png;base64,ZZZ',
  'close_manifest writes signature_client when provided'
);

SELECT is(
  (SELECT signature_client_name FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-2'),
  'Local X',
  'close_manifest writes signature_client_name when provided'
);

-- ── 6. completed_at is exactly NOW(), not some other non-null value ────────
-- Mutation check (H6): asserting IS NOT NULL alone lets completed_at be set
-- to any non-null value (e.g. started_at, or a hardcoded date) and still
-- pass. NOW() is frozen for the lifetime of this transaction (pgTAP tests
-- run inside one BEGIN/ROLLBACK), so the function's NOW() and this
-- assertion's NOW() are guaranteed to be the identical value — an exact
-- equality check, not a "some time passed" heuristic.
-- Also clears the signature written in step 5 above — otherwise rule 3's
-- "already signed" guard (H1 fix) would reject this call, which is not
-- what this assertion is testing.
UPDATE public.manifests
   SET status = 'in_progress', started_at = NOW() - INTERVAL '10 minutes',
       completed_at = NULL, signature_operator = NULL,
       signature_operator_name = NULL, signature_client = NULL,
       signature_client_name = NULL
 WHERE operator_id = '00000000-0000-4000-8000-000000008000'
   AND external_load_id = 'CARGA-80-2';

SELECT is(
  (SELECT out_completed_at FROM public.close_manifest(
    (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-2'),
    '{"operator_signature":"data:image/png;base64,FFF"}'::jsonb
  )),
  NOW(),
  'close_manifest sets completed_at to exactly NOW(), not started_at or any other non-null value'
);

-- ── 7. Rejects a manifest that is already signed (idempotent double-close) ─
SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-1'),
       '{"operator_signature":"data:image/png;base64,CCC"}'::jsonb
     ) $$,
  'P0002',
  'manifest already signed',
  'close_manifest rejects a manifest whose operator signature is already recorded'
);

-- ── 8. H1 — rescues the signature onto a manifest the OTHER closer (hub
--    reception) already marked completed, without a signature ────────────
SELECT is(
  (SELECT signature_operator FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-3'),
  NULL,
  'fixture sanity: CARGA-80-3 starts completed with no signature (simulating the hub-reception closer)'
);

SELECT lives_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-3'),
       '{"operator_signature":"data:image/png;base64,RESCUE"}'::jsonb
     ) $$,
  'close_manifest can still capture the signature on a manifest the hub-reception trigger already completed'
);

SELECT is(
  (SELECT signature_operator FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-3'),
  'data:image/png;base64,RESCUE',
  'the rescued signature is written'
);

SELECT is(
  (SELECT completed_at FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-3'),
  (NOW() - INTERVAL '1 hour')::timestamptz,
  'rescuing the signature does NOT clobber the completed_at the hub-reception trigger already set (COALESCE keeps it)'
);

-- ── 9. H4 — refuses to sign a manifest that was returned to pending ────────
SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-4'),
       '{"operator_signature":"data:image/png;base64,GGG"}'::jsonb
     ) $$,
  'P0001',
  'manifest is not in a closable state (status: pending)',
  'close_manifest refuses to sign a manifest that remove_manifest_from_route returned to pending'
);

SELECT is(
  (SELECT status::text FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008000' AND external_load_id = 'CARGA-80-4'),
  'pending',
  'the rejected pending-manifest attempt left it untouched'
);

SELECT * FROM finish();
ROLLBACK;
