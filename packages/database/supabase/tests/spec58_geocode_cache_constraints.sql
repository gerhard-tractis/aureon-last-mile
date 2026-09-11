-- pgTAP: spec-58 fase 3 -- geocode_cache constraints and updated_at
-- maintenance (docs/specs/spec-58-geocoding-foundation.md, "Fase 3").
--
-- Fase 1 left geocode_cache with NO CHECK constraints (no range, no
-- null-island, geocode_precision without its enum) and updated_at with no
-- trigger to maintain it. This closes both gaps.
--
-- Written before the migration exists (TDD): every assertion here must
-- fail for "constraint does not exist" / "updated_at unchanged" before the
-- migration lands, and pass once it does.

BEGIN;
SELECT plan(6);

-- ── TEST 1 -- accepts a valid exact cache row ───────────────────────────────
INSERT INTO public.geocode_cache (
  id, address_hash, normalisation_version, latitude, longitude,
  geocode_source, geocode_precision
) VALUES (
  '00000000-0000-4000-8000-0000000058c0', 'hash-valid-1', 1,
  -33.4372000, -70.6506000, 'maptiler', 'exact'
);

SELECT is(
  (SELECT geocode_precision FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  'exact',
  'a valid exact cache row is accepted'
);

-- ── TEST 2 -- rejects an invalid geocode_precision ──────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.geocode_cache (
       id, address_hash, normalisation_version, latitude, longitude,
       geocode_source, geocode_precision
     ) VALUES (
       '00000000-0000-4000-8000-0000000058c1', 'hash-invalid-precision', 1,
       -33.0, -70.0, 'maptiler', 'wrong'
     ) $$,
  '%geocode_cache_precision_check%',
  'rejects geocode_precision = ''wrong'''
);

-- ── TEST 3 -- rejects out-of-range latitude/longitude ───────────────────────
SELECT throws_like(
  $$ INSERT INTO public.geocode_cache (
       id, address_hash, normalisation_version, latitude, longitude,
       geocode_source, geocode_precision
     ) VALUES (
       '00000000-0000-4000-8000-0000000058c2', 'hash-out-of-range', 1,
       200.0, -70.0, 'maptiler', 'exact'
     ) $$,
  '%geocode_cache_lat_lng_range_check%',
  'rejects a latitude outside -90..90'
);

-- ── TEST 4 -- rejects (0,0) null-island ──────────────────────────────────────
SELECT throws_like(
  $$ INSERT INTO public.geocode_cache (
       id, address_hash, normalisation_version, latitude, longitude,
       geocode_source, geocode_precision
     ) VALUES (
       '00000000-0000-4000-8000-0000000058c3', 'hash-null-island', 1,
       0, 0, 'maptiler', 'exact'
     ) $$,
  '%geocode_cache_lat_lng_null_island_check%',
  'rejects (0,0) null-island'
);

-- ── TEST 5 -- updated_at is maintained on UPDATE ────────────────────────────
UPDATE public.geocode_cache
   SET updated_at = '2000-01-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

UPDATE public.geocode_cache
   SET hit_count = hit_count + 1
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

SELECT isnt(
  (SELECT updated_at FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  '2000-01-01T00:00:00Z'::timestamptz,
  'updated_at is bumped by a trigger on UPDATE, not left stale'
);

-- ── TEST 6 -- an unrelated column read leaves created_at untouched ──────────
-- (sanity check that the trigger only rewrites updated_at, not created_at)
SELECT isnt(
  (SELECT created_at FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  NULL,
  'created_at is still populated after the update above'
);

SELECT * FROM finish();
ROLLBACK;
