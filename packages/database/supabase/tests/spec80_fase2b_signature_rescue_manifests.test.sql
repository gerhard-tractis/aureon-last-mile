-- pgTAP: spec-80 fase 2b (ronda 3) — get_signature_rescue_manifests() scopes
-- the mobile rescue banner by ownership (driver OR crew, ever — not "still
-- active") and a 30-day window, so a picker sees "their" recent unsigned
-- closures, not the operator's entire unsigned history.
--
-- Fixture, deliberately asymmetric across every dimension the function
-- filters on, so a swap or an inverted condition cannot pass by coincidence:
--   R1 (driver = Ana): M1 unsigned, completed 2 days ago    -> SHOWS (driver, recent)
--   R2 (driver = Beto, crew = Ana): M2 unsigned, 5 days ago -> SHOWS (crew, recent)
--   R3 (driver = Carla, no Ana anywhere): M3 unsigned, 1 day ago -> HIDDEN (not Ana's)
--   R4 (driver = Ana): M4 unsigned, completed 40 days ago   -> HIDDEN (too old)
--   R5 (driver = Ana): M5 SIGNED, completed today           -> HIDDEN (not a rescue)
-- Plus a cross-operator manifest for a DIFFERENT operator, same driver id
-- pattern, to prove operator scoping still applies to the new function.

BEGIN;
SELECT plan(6);

INSERT INTO public.operators (id, name, slug) VALUES
  ('00000000-0000-4000-8000-0000000080c0', 'Spec80c Op', 'spec80c-op'),
  ('00000000-0000-4000-8000-0000000080c9', 'Spec80c Op Other', 'spec80c-op-other')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-0000000080a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'ana-80c@spec80c.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000080c0"}'::jsonb, '{"full_name":"Ana"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-0000000080a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'beto-80c@spec80c.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000080c0"}'::jsonb, '{"full_name":"Beto"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-0000000080a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'carla-80c@spec80c.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-0000000080c0"}'::jsonb, '{"full_name":"Carla"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions) VALUES
  ('00000000-0000-4000-8000-0000000080a1','00000000-0000-4000-8000-0000000080c0','ana-80c@spec80c.test','Ana',ARRAY['pickup']),
  ('00000000-0000-4000-8000-0000000080a2','00000000-0000-4000-8000-0000000080c0','beto-80c@spec80c.test','Beto',ARRAY['pickup']),
  ('00000000-0000-4000-8000-0000000080a3','00000000-0000-4000-8000-0000000080c0','carla-80c@spec80c.test','Carla',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate) VALUES
  ('00000000-0000-4000-8000-0000000080e0','00000000-0000-4000-8000-0000000080c0','ZZ-80C-1')
ON CONFLICT (id) DO NOTHING;

-- Routes: R1 (Ana drives), R2 (Beto drives, Ana crews), R3 (Carla drives, no Ana)
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('00000000-0000-4000-8000-0000000080b1','00000000-0000-4000-8000-0000000080c0','PR-80C-1','00000000-0000-4000-8000-0000000080a1','00000000-0000-4000-8000-0000000080e0','received'),
  ('00000000-0000-4000-8000-0000000080b2','00000000-0000-4000-8000-0000000080c0','PR-80C-2','00000000-0000-4000-8000-0000000080a2','00000000-0000-4000-8000-0000000080e0','received'),
  ('00000000-0000-4000-8000-0000000080b3','00000000-0000-4000-8000-0000000080c0','PR-80C-3','00000000-0000-4000-8000-0000000080a3','00000000-0000-4000-8000-0000000080e0','received')
ON CONFLICT (id) DO NOTHING;

-- Ana was crew on R2 — removed_at IS set (the route is no longer in_progress),
-- proving the query must NOT require removed_at IS NULL.
INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by, removed_at) VALUES
  ('00000000-0000-4000-8000-0000000080c0','00000000-0000-4000-8000-0000000080b2','00000000-0000-4000-8000-0000000080a1','00000000-0000-4000-8000-0000000080a2', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-0000000080d1','00000000-0000-4000-8000-0000000080c0','ORD-80C-1','C','+56911111111','Calle','Santiago', CURRENT_DATE,'CARGA-80C-1','R','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080d2','00000000-0000-4000-8000-0000000080c0','ORD-80C-2','C','+56911111111','Calle','Santiago', CURRENT_DATE,'CARGA-80C-2','R','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080d3','00000000-0000-4000-8000-0000000080c0','ORD-80C-3','C','+56911111111','Calle','Santiago', CURRENT_DATE,'CARGA-80C-3','R','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080d4','00000000-0000-4000-8000-0000000080c0','ORD-80C-4','C','+56911111111','Calle','Santiago', CURRENT_DATE,'CARGA-80C-4','R','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080d5','00000000-0000-4000-8000-0000000080c0','ORD-80C-5','C','+56911111111','Calle','Santiago', CURRENT_DATE,'CARGA-80C-5','R','{}'::jsonb,'MANUAL', NOW()),
  ('00000000-0000-4000-8000-0000000080d9','00000000-0000-4000-8000-0000000080c9','ORD-80C-9','C','+56911111111','Calle','Santiago', CURRENT_DATE,'CARGA-80C-9','R','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- trg_ensure_manifest_for_order already created a manifests row per order.
-- M1: Ana drives R1, unsigned, 2 days old -> SHOWS
UPDATE public.manifests
   SET status='completed', signature_operator = NULL, total_packages = 3, total_orders = 1,
       pickup_route_id = '00000000-0000-4000-8000-0000000080b1',
       completed_at = NOW() - INTERVAL '2 days'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080c0' AND external_load_id = 'CARGA-80C-1';

-- M2: Beto drives R2, Ana crews, unsigned, 5 days old -> SHOWS
UPDATE public.manifests
   SET status='completed', signature_operator = NULL, total_packages = 4, total_orders = 1,
       pickup_route_id = '00000000-0000-4000-8000-0000000080b2',
       completed_at = NOW() - INTERVAL '5 days'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080c0' AND external_load_id = 'CARGA-80C-2';

-- M3: Carla drives R3, Ana nowhere on it, unsigned, 1 day old -> HIDDEN (not Ana's)
UPDATE public.manifests
   SET status='completed', signature_operator = NULL, total_packages = 2, total_orders = 1,
       pickup_route_id = '00000000-0000-4000-8000-0000000080b3',
       completed_at = NOW() - INTERVAL '1 day'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080c0' AND external_load_id = 'CARGA-80C-3';

-- M4: Ana drives R1, unsigned, 40 days old -> HIDDEN (too old — the A1 scenario)
UPDATE public.manifests
   SET status='completed', signature_operator = NULL, total_packages = 6, total_orders = 1,
       pickup_route_id = '00000000-0000-4000-8000-0000000080b1',
       completed_at = NOW() - INTERVAL '40 days'
 WHERE operator_id = '00000000-0000-4000-8000-0000000080c0' AND external_load_id = 'CARGA-80C-4';

-- M5: Ana drives R1, SIGNED, today -> HIDDEN (not a rescue at all)
UPDATE public.manifests
   SET status='completed', signature_operator = 'https://storage.example/sig.png', total_packages = 5, total_orders = 1,
       pickup_route_id = '00000000-0000-4000-8000-0000000080b1',
       completed_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-0000000080c0' AND external_load_id = 'CARGA-80C-5';

-- M9: different operator entirely, same shape as a rescue -> HIDDEN (tenant scope)
UPDATE public.manifests
   SET status='completed', signature_operator = NULL, total_packages = 1, total_orders = 1,
       completed_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-0000000080c9' AND external_load_id = 'CARGA-80C-9';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000080a1","operator_id":"00000000-0000-4000-8000-0000000080c0","role":"authenticated"}',
  true
);

-- ── Assertions (as Ana) ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM public.get_signature_rescue_manifests() WHERE external_load_id = 'CARGA-80C-1'),
  'M1 shows: Ana drove R1, unsigned, 2 days old (within the window)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.get_signature_rescue_manifests() WHERE external_load_id = 'CARGA-80C-2'),
  'M2 shows: Ana was CREW on R2 (even though pickup_route_crew.removed_at is set), unsigned, 5 days old'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.get_signature_rescue_manifests() WHERE external_load_id = 'CARGA-80C-3'),
  'M3 hidden: Ana was never on R3 (Carla''s route) — ownership excludes it even though it is recent and unsigned'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.get_signature_rescue_manifests() WHERE external_load_id = 'CARGA-80C-4'),
  'M4 hidden: Ana drove R1, unsigned, but 40 days old — the exact A1 scenario (legacy noise)'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.get_signature_rescue_manifests() WHERE external_load_id = 'CARGA-80C-5'),
  'M5 hidden: Ana drove R1, recent, but ALREADY signed — not a rescue'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.get_signature_rescue_manifests() WHERE external_load_id = 'CARGA-80C-9'),
  'M9 hidden: a different operator''s unsigned closure never crosses the tenant boundary'
);

SELECT * FROM finish();
ROLLBACK;
