-- pgTAP: spec-58 fase 2 -- comuna centroids on `public.chile_comunas`
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 2").
--
-- Written before the migration exists (TDD) -- every assertion here must
-- fail for "column does not exist" / "NULL centroid" before the migration
-- lands, and pass once it does.
--
-- `chile_comunas` is a global, already-seeded reference table (347 rows,
-- `20260321000001_chile_comunas_normalization.sql:43-407`), not a per-test
-- fixture -- these tests query the real seeded rows, they do not INSERT any.
--
-- Two traps the spec calls out, both encoded here rather than assumed:
--   - The table holds 347 rows, not 346: `14201 Ranco` (Los Ríos) is a
--     *provincia* row, not a comuna, and still needs a non-NULL centroid.
--     TEST 1/2 assert `COUNT(*) FILTER (WHERE centroid_* IS NULL) = 0`
--     rather than a row count, precisely so this pre-existing data bug does
--     not need fixing here to pass.
--   - Three CUT codes fall outside any mainland bounding box: 05201 (Isla
--     de Pascua), 05104 (Juan Fernández), 12202 (Antártica). TEST 3 is
--     "mainland box OR one of those three", never a single rectangle.
--
-- TEST 4 is the transposition guard: in Chile, every longitude is more
-- negative than -65 and no mainland latitude is (mainland latitudes bottom
-- out around -56, at the tip of Patagonia). A swapped lat/lng pair for any
-- mainland comuna puts a value more negative than -65 into centroid_lat
-- (the old longitude) and a value less negative than -65 into centroid_lng
-- (the old latitude) -- this test fails on that swap even though TEST 3's
-- box check might not, since a swapped Santiago pair (-70.65, -33.45) can
-- still coincidentally fall inside generous box bounds on one axis.

BEGIN;
SELECT plan(6);

-- ── TEST 1 -- every comuna row has a non-NULL centroid_lat ─────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM public.chile_comunas WHERE centroid_lat IS NULL),
  0,
  'no chile_comunas row is missing centroid_lat (347 rows, including the 14201 Ranco provincia row)'
);

-- ── TEST 2 -- every comuna row has a non-NULL centroid_lng ─────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM public.chile_comunas WHERE centroid_lng IS NULL),
  0,
  'no chile_comunas row is missing centroid_lng'
);

-- ── TEST 3 -- every centroid is in the mainland box OR is one of the three
--             documented island/Antarctic exceptions ──────────────────────
SELECT is(
  (
    SELECT COUNT(*)::int
      FROM public.chile_comunas
     WHERE codigo_cut NOT IN ('05201', '05104', '12202')
       AND NOT (
         centroid_lat BETWEEN -56 AND -17
         AND centroid_lng BETWEEN -76 AND -66
       )
  ),
  0,
  'every mainland comuna centroid falls inside the Chile mainland bounding box'
);

-- Sanity check on the other side of the OR: the three documented exceptions
-- really do fall outside that same mainland box, so TEST 3 is not vacuously
-- true because nothing was ever excluded.
SELECT is(
  (
    SELECT COUNT(*)::int
      FROM public.chile_comunas
     WHERE codigo_cut IN ('05201', '05104', '12202')
       AND (
         centroid_lat BETWEEN -56 AND -17
         AND centroid_lng BETWEEN -76 AND -66
       )
  ),
  0,
  'the three island/Antarctic exceptions are genuinely outside the mainland box (not a vacuous OR)'
);

-- ── TEST 4 -- no mainland centroid has lat/lng transposed ──────────────────
-- Every Chilean longitude is more negative than -65; no mainland latitude
-- is. A swapped pair puts the old longitude into centroid_lat (more
-- negative than -65, failing "> -65") and/or the old latitude into
-- centroid_lng (less negative than -65, failing "< -65").
SELECT is(
  (
    SELECT COUNT(*)::int
      FROM public.chile_comunas
     WHERE codigo_cut NOT IN ('05201', '05104', '12202')
       AND NOT (centroid_lat > -65 AND centroid_lng < -65)
  ),
  0,
  'no mainland comuna has centroid_lat/centroid_lng transposed'
);

-- ── TEST 5 -- the hand-picked provincia row (14201 Ranco) got a real,
--             sane centroid, not a placeholder like (0,0) or a copy of
--             a neighbouring comuna's exact point ─────────────────────────
SELECT ok(
  (
    SELECT centroid_lat BETWEEN -41 AND -39 AND centroid_lng BETWEEN -73 AND -71
      FROM public.chile_comunas WHERE codigo_cut = '14201'
  ),
  '14201 (Provincia del Ranco) centroid falls within the Los Ríos region'
);

SELECT * FROM finish();
COMMIT;
