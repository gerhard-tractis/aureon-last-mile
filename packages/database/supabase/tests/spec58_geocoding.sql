-- pgTAP: spec-58 fase 1 -- geocode columns on `orders`, the queue index, the
-- `orders_zz_geocode_reset` trigger and `public.geocode_cache`
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 1").
--
-- Written before the migration exists (TDD) -- every assertion here must
-- fail for "column/table/trigger does not exist" before the migration
-- lands, and pass once it does.
--
-- The trigger-ordering test (TEST 10) is the one the spec calls out
-- explicitly: it is the assertion that fails if `orders_zz_geocode_reset`
-- is ever renamed to something that no longer sorts after
-- `orders_normalize_comuna_trigger` (BEFORE-trigger firing order is
-- alphabetical by name within the same event). Santiago -> "providencia"
-- (raw, lowercase) is a real comuna change, not a no-op: if the reset
-- trigger read `comuna_id` before the normalize trigger had a chance to
-- recompute it, this test would see no reset and fail.

BEGIN;
SELECT plan(20);

-- ── Fixtures ─────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000005800', 'Spec58 Op', 'spec58-op')
ON CONFLICT (id) DO NOTHING;

-- ── TEST 1 -- accepts a valid coordinate pair ───────────────────────────────
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  latitude, longitude, geocode_source, geocode_precision, geocode_status,
  geocoded_at
) VALUES (
  '00000000-0000-4000-8000-0000000058a0', '00000000-0000-4000-8000-000000005800',
  'ORD-58-0', 'Cliente 58', '+56900000580', 'Av. Providencia 1234', 'Santiago',
  CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(),
  -33.4372000, -70.6506000, 'maptiler', 'exact', 'resolved', NOW()
);

SELECT is(
  (SELECT (latitude, longitude, geocode_status)
     FROM public.orders WHERE id = '00000000-0000-4000-8000-0000000058a0'),
  (-33.4372000::decimal(10,7), -70.6506000::decimal(10,7), 'resolved'::text),
  'a valid resolved coordinate pair is accepted'
);

-- ── TEST 2 -- rejects an invalid geocode_precision ──────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       latitude, longitude, geocode_precision
     ) VALUES (
       '00000000-0000-4000-8000-0000000058a1', '00000000-0000-4000-8000-000000005800',
       'ORD-58-1', 'Cliente 58', '+56900000580', 'Calle 58', 'Santiago',
       CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), -33.0, -70.0, 'wrong'
     ) $$,
  '%orders_geocode_precision_check%',
  'rejects geocode_precision = ''wrong'''
);

-- ── TEST 3 -- rejects an invalid geocode_status ─────────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       geocode_status
     ) VALUES (
       '00000000-0000-4000-8000-0000000058a2', '00000000-0000-4000-8000-000000005800',
       'ORD-58-2', 'Cliente 58', '+56900000580', 'Calle 58', 'Santiago',
       CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 'bogus'
     ) $$,
  '%orders_geocode_status_check%',
  'rejects an invalid geocode_status'
);

-- ── TEST 4 -- rejects latitude without longitude, by constraint name ───────
SELECT throws_like(
  $$ INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       latitude, longitude
     ) VALUES (
       '00000000-0000-4000-8000-0000000058a3', '00000000-0000-4000-8000-000000005800',
       'ORD-58-3', 'Cliente 58', '+56900000580', 'Calle 58', 'Santiago',
       CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), -33.0, NULL
     ) $$,
  '%orders_geocode_lat_lng_pair_check%',
  'rejects latitude set with longitude NULL, and names the pair constraint'
);

-- ── TEST 5 -- rejects (0,0) ──────────────────────────────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       latitude, longitude
     ) VALUES (
       '00000000-0000-4000-8000-0000000058a4', '00000000-0000-4000-8000-000000005800',
       'ORD-58-4', 'Cliente 58', '+56900000580', 'Calle 58', 'Santiago',
       CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 0, 0
     ) $$,
  '%orders_geocode_lat_lng_null_island_check%',
  'rejects a (0,0) null-island pair'
);

-- ── TEST 6 -- rejects an out-of-range latitude ──────────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       latitude, longitude
     ) VALUES (
       '00000000-0000-4000-8000-0000000058a5', '00000000-0000-4000-8000-000000005800',
       'ORD-58-5', 'Cliente 58', '+56900000580', 'Calle 58', 'Santiago',
       CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), 91, -70
     ) $$,
  '%orders_geocode_lat_lng_range_check%',
  'rejects an out-of-range latitude (91)'
);

-- ── TEST 7 -- rejects an out-of-range longitude ─────────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       latitude, longitude
     ) VALUES (
       '00000000-0000-4000-8000-0000000058a6', '00000000-0000-4000-8000-000000005800',
       'ORD-58-6', 'Cliente 58', '+56900000580', 'Calle 58', 'Santiago',
       CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW(), -33, -181
     ) $$,
  '%orders_geocode_lat_lng_range_check%',
  'rejects an out-of-range longitude (-181)'
);

-- ── TEST 8 -- the address-change trigger resets state ───────────────────────
-- geocode_attempts and geocode_next_attempt_at are born 0/NULL by DEFAULT,
-- so asserting a reset to 0/NULL without first moving them away from the
-- default proves nothing -- give this row a simulated retry history (as
-- fase 5's worker would leave behind after a coarse/failed attempt) so the
-- assertion below can only pass if the trigger actually reset them. This
-- is the pair Decision 4 / fase 5's retry ladder depends on: without this
-- reset, a corrected address would re-enter the queue with attempts
-- already spent and a backoff window inherited from a DIFFERENT address,
-- landing at 'unresolvable' early.
UPDATE public.orders
   SET geocode_attempts = 2, geocode_next_attempt_at = NOW() + INTERVAL '30 minutes'
 WHERE id = '00000000-0000-4000-8000-0000000058a0';

UPDATE public.orders
   SET delivery_address = 'Av. Providencia 4321'
 WHERE id = '00000000-0000-4000-8000-0000000058a0';

SELECT is(
  (SELECT (latitude, longitude, geocoded_at, geocode_source, geocode_precision,
           geocode_status, geocode_attempts, geocode_next_attempt_at)
     FROM public.orders WHERE id = '00000000-0000-4000-8000-0000000058a0'),
  (NULL::decimal(10,7), NULL::decimal(10,7), NULL::timestamptz, NULL::text,
   NULL::text, 'pending'::text, 0, NULL::timestamptz),
  'editing delivery_address resets every geocode column to its untried state'
);

-- ── TEST 9 -- an unrelated column update does not reset ─────────────────────
UPDATE public.orders
   SET latitude = -33.5, longitude = -70.5, geocode_status = 'resolved',
       geocode_precision = 'exact', geocode_source = 'maptiler', geocoded_at = NOW()
 WHERE id = '00000000-0000-4000-8000-0000000058a0';

UPDATE public.orders
   SET customer_name = 'Cliente 58 renombrado'
 WHERE id = '00000000-0000-4000-8000-0000000058a0';

SELECT is(
  (SELECT (latitude, longitude, geocode_status)
     FROM public.orders WHERE id = '00000000-0000-4000-8000-0000000058a0'),
  (-33.5::decimal(10,7), -70.5::decimal(10,7), 'resolved'::text),
  'updating an unrelated column (customer_name) does not touch geocode state'
);

-- ── TEST 10 -- zz-ordering: a raw `comuna` edit that changes comuna_id via
--    the normalization trigger, in the SAME statement, still resets ─────────
-- comuna_id from the initial insert (raw 'Santiago', case-correct already)
SELECT is(
  (SELECT comuna FROM public.orders WHERE id = '00000000-0000-4000-8000-0000000058a0'),
  'Santiago',
  'sanity: fixture order starts in comuna Santiago'
);

UPDATE public.orders
   SET comuna = 'providencia' -- raw, lowercase, different comuna
 WHERE id = '00000000-0000-4000-8000-0000000058a0';

SELECT is(
  (SELECT (comuna, latitude, longitude, geocode_status, geocode_attempts)
     FROM public.orders WHERE id = '00000000-0000-4000-8000-0000000058a0'),
  ('Providencia'::varchar(100), NULL::decimal(10,7), NULL::decimal(10,7), 'pending'::text, 0),
  'a raw comuna edit that changes comuna_id (via orders_normalize_comuna_trigger, same statement) still resets -- proves orders_zz_geocode_reset fires AFTER normalization'
);

-- ── TEST 11 -- idx_orders_geocode_queue exists ──────────────────────────────
SELECT has_index('public', 'orders', 'idx_orders_geocode_queue',
  'idx_orders_geocode_queue exists');

-- ── TEST 12 -- geocode_cache: unique on (address_hash, normalisation_version) ─
INSERT INTO public.geocode_cache (
  address_hash, normalisation_version, latitude, longitude, geocode_source, geocode_precision
) VALUES (
  'aaaa0000000000000000000000000000000000000000000000000000000058', 1,
  -33.4372000, -70.6506000, 'maptiler', 'exact'
);

SELECT throws_ok(
  $$ INSERT INTO public.geocode_cache (
       address_hash, normalisation_version, latitude, longitude, geocode_source, geocode_precision
     ) VALUES (
       'aaaa0000000000000000000000000000000000000000000000000000000058', 1,
       -1.0, -1.0, 'maptiler', 'exact'
     ) $$,
  '23505',
  NULL,
  'duplicate (address_hash, normalisation_version) is rejected'
);

-- ── TEST 13 -- address_hash alone is deliberately NOT unique ────────────────
INSERT INTO public.geocode_cache (
  address_hash, normalisation_version, latitude, longitude, geocode_source, geocode_precision
) VALUES (
  'aaaa0000000000000000000000000000000000000000000000000000000058', 2,
  -33.4372000, -70.6506000, 'maptiler', 'exact'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.geocode_cache
     WHERE address_hash = 'aaaa0000000000000000000000000000000000000000000000000000000058'),
  2,
  'the same address_hash coexists across two normalisation_version rows'
);

-- ── TEST 14 -- geocode_cache is unreadable by anon ──────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT 1 FROM public.geocode_cache LIMIT 1 $$,
  '42501',
  NULL,
  'anon cannot SELECT from geocode_cache'
);
RESET ROLE;

-- ── TEST 15 -- geocode_cache is unreadable by authenticated ─────────────────
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT 1 FROM public.geocode_cache LIMIT 1 $$,
  '42501',
  NULL,
  'authenticated cannot SELECT from geocode_cache'
);
RESET ROLE;

-- ── TEST 16 -- geocode_cache has RLS enabled ─────────────────────────────────
SELECT is(
  (SELECT relrowsecurity FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relname = 'geocode_cache'),
  true,
  'geocode_cache has RLS enabled'
);

-- ── TEST 17 -- geocode_cache has no client-facing RLS policy ────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'geocode_cache'),
  0,
  'geocode_cache carries no RLS policy at all -- the REVOKE is the only gate'
);

-- ── TEST 18 -- geocode_cache has no deleted_at (documented soft-delete
--    exception -- it is a rebuildable cache, not a business record) ────────
SELECT hasnt_column('public', 'geocode_cache', 'deleted_at',
  'geocode_cache deliberately has no deleted_at (documented soft-delete exception)');

-- ── TEST 19 -- orders keeps its normal RLS shape untouched ──────────────────
SELECT is(
  (SELECT relrowsecurity FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relname = 'orders'),
  true,
  'orders RLS is untouched by this migration (still enabled)'
);

SELECT * FROM finish();
ROLLBACK;
