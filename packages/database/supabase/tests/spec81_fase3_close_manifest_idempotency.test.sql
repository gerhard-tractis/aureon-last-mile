-- pgTAP: spec-81 fase 3 — close_manifest's retry safety, decided WITHOUT a
-- new client_operation_id column on public.manifests.
--
-- Decision (spec-81 fase 3, see the migration header for the argument in
-- full): a manifest can be signed at most once, ever — that invariant is
-- already the operation's natural idempotency key, enforced by
-- close_manifest's own `signature_operator IS NOT NULL` guard
-- (20260913000004, "Rule 3"), which raises 23505
-- MANIFEST_ALREADY_SIGNED — the same sentinel-prefixed 23505/409 shape this
-- fase uses for pickup_scans, not P0002/404. A client_operation_id column
-- on manifests would duplicate that guard without changing what it
-- protects: retrying close_manifest(manifest_id, signatures) after a lost
-- 200 hits the identical branch regardless of whether the retry carries the
-- same operation id or a freshly generated one, because the key that
-- matters is manifest_id + "already has a signature", not an
-- operation id nobody needs to distinguish successive calls by.
--
-- This file does not touch close_manifest's body — it only proves, from
-- outside, that today's function already satisfies fase 3's checklist item
-- ("la misma operación dos veces deja una fila y no altera conteos") for
-- the manifests table. has_function_signature guards against the function
-- having been dropped/renamed, per the repo's "a test that passes if the
-- function does not exist" trap.

BEGIN;
SELECT plan(6);

-- =============================================================================
-- TEST 1 — close_manifest still exists with this fase's expected signature.
-- =============================================================================
SELECT has_function(
  'public', 'close_manifest', ARRAY['uuid', 'jsonb'],
  'TEST 1: public.close_manifest(uuid, jsonb) exists'
);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000008200', 'Spec81 Fase3 CM Op', 'spec81-fase3-cm-op')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-000000008210',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-a@spec81fase3.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000008200"}'::jsonb,
   '{"full_name":"Crew Fase3"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-000000008210','00000000-0000-4000-8000-000000008200','crew-a@spec81fase3.test','Crew Fase3',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-000000008220','00000000-0000-4000-8000-000000008200',
   'ORD-81F3-1','Cliente 81F3','+56911111111','Calle 81F3','Santiago', CURRENT_DATE,
   'CARGA-81F3-1','Retailer 81F3','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-000000008240','00000000-0000-4000-8000-000000008200',
   '00000000-0000-4000-8000-000000008220','CTN81F3-1','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

UPDATE public.manifests
   SET status = 'in_progress', started_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000008200'
   AND external_load_id = 'CARGA-81F3-1';

INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES (
  '00000000-0000-4000-8000-000000008200',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008200' AND external_load_id = 'CARGA-81F3-1'),
  '00000000-0000-4000-8000-000000008240', 'CTN81F3-1', 'verified', NOW()
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000008210","operator_id":"00000000-0000-4000-8000-000000008200","role":"authenticated"}',
  true
);

-- =============================================================================
-- TEST 2 — first close succeeds and reports the real verified count.
-- =============================================================================
SELECT is(
  (SELECT out_verified_count FROM public.close_manifest(
    (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008200' AND external_load_id = 'CARGA-81F3-1'),
    '{"operator_signature":"data:image/png;base64,AAA"}'::jsonb
  )),
  1,
  'TEST 2: the first close reports verified_count = 1'
);

-- =============================================================================
-- TEST 3 — a retry of the SAME close (offline queue resend after a lost
-- 200) is rejected as 23505, not silently re-applied and not 404/P0002.
-- =============================================================================
SELECT throws_ok(
  $$ SELECT public.close_manifest(
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008200' AND external_load_id = 'CARGA-81F3-1'),
       '{"operator_signature":"data:image/png;base64,AAA"}'::jsonb
     ) $$,
  '23505',
  'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature',
  'TEST 3: a retried close_manifest call is rejected as a 409 (23505), never P0002/404 — the offline queue drainer must not read it as "does not exist"'
);

-- =============================================================================
-- TEST 4 — the retry did not create a second manifests row.
-- =============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008200' AND external_load_id = 'CARGA-81F3-1'),
  1,
  'TEST 4: exactly one manifests row exists after the retry — no duplicate row'
);

-- =============================================================================
-- TEST 5 — the rejected retry did not alter the signature already written.
-- =============================================================================
SELECT is(
  (SELECT signature_operator FROM public.manifests
    WHERE operator_id = '00000000-0000-4000-8000-000000008200' AND external_load_id = 'CARGA-81F3-1'),
  'data:image/png;base64,AAA',
  'TEST 5: the rejected retry left the original signature untouched'
);

-- =============================================================================
-- TEST 6 — the rejected retry did not alter the verified count a fresh
-- close would report (queried the same way close_manifest computes it).
-- =============================================================================
SELECT is(
  (SELECT COUNT(DISTINCT ps.package_id)::int
     FROM public.pickup_scans ps
    WHERE ps.manifest_id = (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008200' AND external_load_id = 'CARGA-81F3-1')
      AND ps.scan_result = 'verified'
      AND ps.deleted_at IS NULL),
  1,
  'TEST 6: the verified-package count is unchanged by the rejected retry'
);

SELECT * FROM finish();
ROLLBACK;
