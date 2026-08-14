-- pgTAP: every CARGA gets a manifests row (20260814000001)
BEGIN;
SELECT plan(5);

-- Fixture, following the spec52_vehicles_rls.sql pattern. The operator MUST be
-- inserted first: handle_new_user() fires on the auth.users insert and writes
-- public.users.operator_id from raw_app_meta_data, which FKs to operators.
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-0000000005b1', 'Carga Trigger Op', 'carga-trigger-op')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
VALUES (
  '00000000-0000-4000-8000-0000000005a1', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'carga-trigger@test.local',
  jsonb_build_object('operator_id', '00000000-0000-4000-8000-0000000005b1')
);

-- ── 1. Inserting an order for a brand-new CARGA creates the manifests row ────
INSERT INTO public.orders (
  operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES (
  '00000000-0000-4000-8000-0000000005b1', 'ORD-CT-1', 'Cliente Uno', '+56900000001',
  'Calle Falsa 123', 'Providencia', CURRENT_DATE, 'CARGA-TRIGGER-001', 'Paris',
  '{}'::jsonb, 'MANUAL', NOW()
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.manifests
    WHERE external_load_id = 'CARGA-TRIGGER-001'
      AND operator_id = '00000000-0000-4000-8000-0000000005b1'),
  1,
  'inserting an order creates exactly one manifests row for the CARGA'
);

SELECT is(
  (SELECT status::TEXT FROM public.manifests WHERE external_load_id = 'CARGA-TRIGGER-001'),
  'pending',
  'the new manifests row is pending, not in_progress — nobody has scanned yet'
);

SELECT is(
  (SELECT retailer_name FROM public.manifests WHERE external_load_id = 'CARGA-TRIGGER-001'),
  'Paris',
  'retailer_name carries over from the order'
);

-- ── 2. A second order on the same CARGA does not create a duplicate ──────────
INSERT INTO public.orders (
  operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES (
  '00000000-0000-4000-8000-0000000005b1', 'ORD-CT-2', 'Cliente Dos', '+56900000002',
  'Calle Falsa 456', 'Ñuñoa', CURRENT_DATE, 'CARGA-TRIGGER-001', 'Paris',
  '{}'::jsonb, 'MANUAL', NOW()
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.manifests
    WHERE external_load_id = 'CARGA-TRIGGER-001'
      AND operator_id = '00000000-0000-4000-8000-0000000005b1'),
  1,
  'a second order on the same CARGA does not create a duplicate manifests row'
);

-- ── 3. The backfill invariant holds globally ─────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::INT FROM (
     SELECT DISTINCT o.operator_id, o.external_load_id
     FROM   public.orders o
     WHERE  o.external_load_id IS NOT NULL
       AND  o.deleted_at IS NULL
       AND  NOT EXISTS (
              SELECT 1 FROM public.manifests m
              WHERE  m.operator_id = o.operator_id
                AND  m.external_load_id = o.external_load_id
            )
   ) orphans),
  0,
  'no CARGA anywhere is left without a manifests row'
);

SELECT * FROM finish();
ROLLBACK;
