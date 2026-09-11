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
SELECT plan(8);

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

-- ── TEST 5 -- updated_at is bumped when the cached coordinate DATA changes ──
-- (review decision: updated_at tracks "when this row's data was last
-- written", scoped to the substantive columns -- not a blanket
-- BEFORE UPDATE, so it stays a distinct signal from last_used_at below)
UPDATE public.geocode_cache
   SET updated_at = '2000-01-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

UPDATE public.geocode_cache
   SET latitude = -33.4400000
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

SELECT isnt(
  (SELECT updated_at FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  '2000-01-01T00:00:00Z'::timestamptz,
  'updated_at is bumped by a trigger when latitude changes, not left stale'
);

-- ── TEST 6 -- updated_at is NOT bumped by a hit_count/last_used_at-only
--    write (review decision: a cache HIT must not look like a data WRITE) ──
UPDATE public.geocode_cache
   SET updated_at = '2000-01-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

UPDATE public.geocode_cache
   SET hit_count = hit_count + 1, last_used_at = now()
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

SELECT is(
  (SELECT updated_at FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  '2000-01-01T00:00:00Z'::timestamptz,
  'updated_at is untouched by a hit_count/last_used_at-only update -- distinct signal from last_used_at'
);

-- ── TEST 7 -- created_at survives a real data UPDATE unchanged ─────────────
-- (captures the value before, not just "is it non-null" -- a trigger
-- mutated to also rewrite created_at would pass a bare NOT-NULL check.
--
-- A sentinel value, not a captured-then-compared NOW(): the whole file
-- runs inside one BEGIN...ROLLBACK transaction, and Postgres freezes
-- NOW()/CURRENT_TIMESTAMP to the transaction's start for its entire
-- duration -- so a mutated trigger that sets `created_at = NOW()` would
-- write back the EXACT same timestamp the row already had, and a
-- before/after NOW()-based comparison would never catch it. This mirrors
-- how tests 5/6 already detect updated_at changes: set a value that could
-- never arise naturally, then assert it does or doesn't survive.)
UPDATE public.geocode_cache
   SET created_at = '1999-01-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

UPDATE public.geocode_cache
   SET latitude = -33.4500000
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

SELECT is(
  (SELECT created_at FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  '1999-01-01T00:00:00Z'::timestamptz,
  'created_at is unchanged by the set_updated_at trigger firing on a real data update'
);

-- ── TEST 8 -- updated_at is bumped when address_hash is re-keyed ───────────
-- (review finding N1: the UPDATE OF list had normalisation_version but not
-- address_hash, even though they are the two halves of the same UNIQUE.
-- Re-keying address_hash is the most substantive rewrite possible for this
-- row -- the coordinate now belongs to a different address -- so it must
-- bump updated_at exactly like a coordinate/source/precision change does.)
UPDATE public.geocode_cache
   SET updated_at = '2000-01-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

UPDATE public.geocode_cache
   SET address_hash = 'hash-valid-1-rekeyed'
 WHERE id = '00000000-0000-4000-8000-0000000058c0';

SELECT isnt(
  (SELECT updated_at FROM public.geocode_cache
     WHERE id = '00000000-0000-4000-8000-0000000058c0'),
  '2000-01-01T00:00:00Z'::timestamptz,
  'updated_at is bumped by a trigger when address_hash is re-keyed'
);

SELECT * FROM finish();
ROLLBACK;
