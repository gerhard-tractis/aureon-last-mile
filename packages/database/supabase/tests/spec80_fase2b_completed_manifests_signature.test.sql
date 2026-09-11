-- pgTAP: spec-80 fase 2b (ronda 2) — get_completed_manifests() gains
-- signature_operator, so mobile can find a manifest trg_route_receptions_
-- status_sync completed WITHOUT a signature — operator-wide, since by the
-- time that state exists the manifest's own route is no longer in_progress
-- (get_my_active_pickup_route filters on it) and useRouteManifests (route-
-- scoped) can no longer see it.
--
-- Fixture, deliberately asymmetric (2 rescue-shaped + 1 genuinely-signed +
-- 1 with a real print job attached, so a swap of the two columns this
-- migration touches would be caught):
--   CARGA-80B-1: status='completed', signature_operator=NULL   -> rescue
--   CARGA-80B-2: status='completed', signature_operator set    -> NOT rescue
--   CARGA-80B-3: status='completed', signature_operator=NULL, ALSO has a
--                real labels_printed_by_name -> proves this CREATE OR
--                REPLACE didn't silently drop the spec-53 LEFT JOIN while
--                adding the new column.

BEGIN;
SELECT plan(4);

INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-0000000080b0', 'Spec80b Op', 'spec80b-op')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-0000000080b1',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-80b@spec80b.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000080b0"}'::jsonb,
   '{"full_name":"Crew 80b"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-0000000080b1','00000000-0000-4000-8000-0000000080b0','crew-80b@spec80b.test','Crew 80b',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-0000000080c0','00000000-0000-4000-8000-0000000080b0',
   'ORD-80B-1','Cliente 80b','+56911111111','Calle 80b','Santiago', CURRENT_DATE,
   'CARGA-80B-1','Retailer 80b','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080c1','00000000-0000-4000-8000-0000000080b0',
   'ORD-80B-2','Cliente 80b','+56911111111','Calle 80b','Santiago', CURRENT_DATE,
   'CARGA-80B-2','Retailer 80b','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080c2','00000000-0000-4000-8000-0000000080b0',
   'ORD-80B-3','Cliente 80b','+56911111111','Calle 80b','Santiago', CURRENT_DATE,
   'CARGA-80B-3','Retailer 80b','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- 20260814000001's trg_ensure_manifest_for_order already created a manifests
-- row per load the moment its order was inserted.
--
-- reception_status = 'received' on all three (spec-94 fase 1): get_completed_
-- manifests() no longer partitions on status='completed' alone. With NO
-- pickup_route_id set (this fixture's shape), the function's "sin ruta viva"
-- arm requires reception_status='received' OR (completed AND reception_
-- status IS NULL) -- and IS NULL is unreachable here because trg_manifest_
-- set_reception_status (spec-08, still live) auto-fills reception_status=
-- 'awaiting_reception' the instant status transitions to 'completed' with
-- the column NULL. Setting 'received' explicitly is the honest fixture for
-- that arm -- NOT a claim that this is how production reaches "received":
-- both real writers (20260625000001:198-201, 20260812000006:185-189) filter
-- `WHERE pickup_route_id = NEW.id`, so a genuinely-received load in
-- production KEEPS its route and goes through the "ruta viva" arm
-- (pr.status='received') instead. This fixture exercises the other,
-- route-less arm of the SAME predicate -- a state the RPC must still get
-- right regardless of which code path reaches it.
UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 5, total_orders = 1,
       signature_operator = NULL, reception_status = 'received'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
   AND external_load_id = 'CARGA-80B-1';

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 8, total_orders = 1,
       signature_operator = 'https://storage.example/sig-80b-2.png', reception_status = 'received'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
   AND external_load_id = 'CARGA-80B-2';

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW(), total_packages = 3, total_orders = 1,
       signature_operator = NULL, reception_status = 'received',
       labels_printed_at = NOW(), labels_printed_by = '00000000-0000-4000-8000-0000000080b1'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080b0'
   AND external_load_id = 'CARGA-80B-3';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000080b1","operator_id":"00000000-0000-4000-8000-0000000080b0","role":"authenticated"}',
  true
);

-- ── Assertions ───────────────────────────────────────────────────────────────
SELECT is(
  (SELECT signature_operator FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-80B-1'),
  NULL::text,
  'CARGA-80B-1: trg-style rescue (no signature) reports signature_operator NULL'
);

SELECT is(
  (SELECT signature_operator FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-80B-2'),
  'https://storage.example/sig-80b-2.png',
  'CARGA-80B-2: genuinely-signed close reports the real signature_operator value, not NULL'
);

SELECT is(
  (SELECT total_packages FROM public.get_completed_manifests()
    WHERE external_load_id = 'CARGA-80B-1'),
  5,
  'CARGA-80B-1 still reports total_packages=5 (pre-existing contract unchanged)'
);

-- Asymmetric guard: CARGA-80B-3 is ALSO a rescue (signature_operator NULL)
-- but carries a REAL label-print name, proving this CREATE OR REPLACE did
-- not silently drop the spec-53 LEFT JOIN users while adding the new column
-- — a fixture with only NULLs on both columns would not catch that swap.
SELECT is(
  (SELECT (signature_operator IS NULL, labels_printed_by_name)
     FROM public.get_completed_manifests() WHERE external_load_id = 'CARGA-80B-3'),
  (true, 'Crew 80b'::text),
  'CARGA-80B-3: rescue AND a real labels_printed_by_name survive together (spec-53 contract intact)'
);

SELECT * FROM finish();
ROLLBACK;
