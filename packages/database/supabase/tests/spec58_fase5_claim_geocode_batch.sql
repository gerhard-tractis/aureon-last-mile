-- pgTAP: spec-58 fase 5 -- claim_geocode_batch (docs/specs/spec-58-geocoding-foundation.md, "Fase 5")
--
-- Written before the migration exists (TDD): every assertion here must fail
-- for "function does not exist" before the migration lands, and pass once
-- it does.
--
-- Each test below uses its OWN fixture rows (distinct id ranges) rather
-- than sharing one set: claim_geocode_batch is not read-only -- calling it
-- leases the rows it returns -- so a shared fixture would make an earlier
-- test's call change what a later test sees.

BEGIN;
SELECT plan(9);

INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000005850', 'Spec58 Fase5 Op', 'spec58-fase5-op')
ON CONFLICT (id) DO NOTHING;

-- ── TEST 1 -- claims only pending/fallback, not-deleted, due rows ──────────
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058100', '00000000-0000-4000-8000-000000005850',
  'ORD-58-100', 'Cliente', '+56900000581', 'Calle Uno 100', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW() - INTERVAL '2 hours'
);
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, geocode_next_attempt_at, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058101', '00000000-0000-4000-8000-000000005850',
  'ORD-58-101', 'Cliente', '+56900000581', 'Calle Dos 200', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'fallback', NOW() - INTERVAL '1 minute',
  NOW() - INTERVAL '1 hour'
);
INSERT INTO public.orders ( -- not due yet -- must not be claimed
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, geocode_next_attempt_at, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058102', '00000000-0000-4000-8000-000000005850',
  'ORD-58-102', 'Cliente', '+56900000581', 'Calle Tres 300', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'fallback', NOW() + INTERVAL '6 days',
  NOW() - INTERVAL '30 minutes'
);
INSERT INTO public.orders ( -- resolved -- must not be claimed
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  latitude, longitude, geocode_source, geocode_precision, geocode_status, geocoded_at, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058103', '00000000-0000-4000-8000-000000005850',
  'ORD-58-103', 'Cliente', '+56900000581', 'Calle Cuatro 400', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(),
  -33.0, -70.0, 'maptiler', 'exact', 'resolved', NOW(), NOW() - INTERVAL '10 minutes'
);
INSERT INTO public.orders ( -- soft-deleted, otherwise-eligible -- must not be claimed
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, deleted_at, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058104', '00000000-0000-4000-8000-000000005850',
  'ORD-58-104', 'Cliente', '+56900000581', 'Calle Cinco 500', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW(), NOW() - INTERVAL '3 hours'
);

SELECT results_eq(
  $$ SELECT id FROM public.claim_geocode_batch(10, 10)
      WHERE id IN (
        '00000000-0000-4000-8000-000000058100', '00000000-0000-4000-8000-000000058101',
        '00000000-0000-4000-8000-000000058102', '00000000-0000-4000-8000-000000058103',
        '00000000-0000-4000-8000-000000058104'
      )
      ORDER BY id $$,
  $$ VALUES
      ('00000000-0000-4000-8000-000000058100'::uuid),
      ('00000000-0000-4000-8000-000000058101'::uuid)
  $$,
  'claims the untried row and the due fallback row; excludes not-yet-due, resolved and soft-deleted rows'
);

-- ── TEST 2 -- LIMIT is respected ─────────────────────────────────────────
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, created_at
) VALUES
  ('00000000-0000-4000-8000-000000058200', '00000000-0000-4000-8000-000000005850',
   'ORD-58-200', 'Cliente', '+56900000582', 'Calle A 1', 'Santiago',
   CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW() - INTERVAL '2 hours'),
  ('00000000-0000-4000-8000-000000058201', '00000000-0000-4000-8000-000000005850',
   'ORD-58-201', 'Cliente', '+56900000582', 'Calle B 2', 'Santiago',
   CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW() - INTERVAL '2 hours');

SELECT is(
  (SELECT COUNT(*)::int FROM public.claim_geocode_batch(1, 10)
     WHERE id IN ('00000000-0000-4000-8000-000000058200', '00000000-0000-4000-8000-000000058201')),
  1,
  'p_limit caps the number of rows claimed'
);

-- Drain whatever is still eligible from TEST 2's own fixture (LIMIT 1 there
-- claimed only one of its two rows, leaving the other genuinely eligible)
-- before setting up TEST 3's ordering comparison -- otherwise that leftover
-- row, with an earlier created_at than either fixture below, wins the
-- NULLS-FIRST tie and this test would be comparing against the wrong pool.
SELECT * FROM public.claim_geocode_batch(1000, 1);

-- ── TEST 3 -- ORDER BY geocode_next_attempt_at NULLS FIRST, created_at ─────
-- The due fallback row's created_at is much earlier, but its
-- geocode_next_attempt_at is a real (past) timestamp; the untried row's is
-- NULL. NULLS FIRST must put the untried row first regardless of created_at.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, geocode_next_attempt_at, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058300', '00000000-0000-4000-8000-000000005850',
  'ORD-58-300', 'Cliente', '+56900000583', 'Calle C 3', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'fallback', NOW() - INTERVAL '1 minute',
  NOW() - INTERVAL '10 hours'
);
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058301', '00000000-0000-4000-8000-000000005850',
  'ORD-58-301', 'Cliente', '+56900000583', 'Calle D 4', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW() - INTERVAL '1 minute'
);

SELECT is(
  (SELECT id FROM public.claim_geocode_batch(1, 10)
     WHERE id IN ('00000000-0000-4000-8000-000000058300', '00000000-0000-4000-8000-000000058301')),
  '00000000-0000-4000-8000-000000058301'::uuid,
  'NULL geocode_next_attempt_at sorts before an older past-due timestamp (NULLS FIRST)'
);

-- ── TEST 4 -- the claim leases the row (bumps geocode_next_attempt_at) ─────
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058400', '00000000-0000-4000-8000-000000005850',
  'ORD-58-400', 'Cliente', '+56900000584', 'Calle E 5', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW()
);

SELECT * FROM public.claim_geocode_batch(10, 10);

SELECT ok(
  (SELECT geocode_next_attempt_at > NOW() + INTERVAL '9 minutes'
     FROM public.orders WHERE id = '00000000-0000-4000-8000-000000058400'),
  'a claimed row''s geocode_next_attempt_at is leased into the future'
);

-- ── TEST 5 -- the lease excludes the row from an immediate second claim ────
-- Proves the LEASE, not just the FOR UPDATE lock, protects the batch: each
-- statement is its own implicit transaction (no explicit multi-statement
-- BEGIN around the claim itself), so by the time this second call runs the
-- row lock from TEST 4's call has already released. Only the lease (a
-- future geocode_next_attempt_at) can be what excludes the row here.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.claim_geocode_batch(10, 10)
     WHERE id = '00000000-0000-4000-8000-000000058400'
  ),
  'a freshly-leased row is not re-claimed by an immediate second call'
);

-- ── TEST 6 -- a row from a different fixture, never leased, remains
--    claimable independent of the calls above ─────────────────────────────
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  geocode_status, created_at
) VALUES (
  '00000000-0000-4000-8000-000000058500', '00000000-0000-4000-8000-000000005850',
  'ORD-58-500', 'Cliente', '+56900000585', 'Calle F 6', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'pending', NOW()
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.claim_geocode_batch(10, 10)
     WHERE id = '00000000-0000-4000-8000-000000058500'
  ),
  'an untouched eligible row is claimable regardless of unrelated prior claims'
);

-- ── TEST 7 -- EXECUTE is revoked from PUBLIC (anon cannot call it) ─────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM public.claim_geocode_batch(1, 1) $$,
  '42501',
  NULL,
  'anon cannot execute claim_geocode_batch'
);
RESET ROLE;

-- ── TEST 8 -- EXECUTE is revoked from PUBLIC (authenticated cannot call it) ─
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.claim_geocode_batch(1, 1) $$,
  '42501',
  NULL,
  'authenticated cannot execute claim_geocode_batch'
);
RESET ROLE;

-- ── TEST 9 -- service_role can execute it ──────────────────────────────────
SELECT ok(
  has_function_privilege('service_role', 'public.claim_geocode_batch(int,int)', 'EXECUTE'),
  'service_role has EXECUTE on claim_geocode_batch'
);

SELECT * FROM finish();
ROLLBACK;
