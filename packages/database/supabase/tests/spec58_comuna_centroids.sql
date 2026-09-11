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
-- Round 1 review found a single-row transposition check (bounds a strict
-- subset of TEST 3's box, so it could never fail independently) and
-- removed it in favour of TEST 5/6 below, which are the assertion it was
-- actually trying to be: catching a plausible-looking point that is still
-- wrong. TEST 5 catches a cross-region swap (e.g. Arica's point copied
-- onto Punta Arenas' row) that neither the box nor a same-row check can,
-- because both points are individually valid Chilean coordinates. TEST 7
-- catches a same-region copy-paste (e.g. onto a neighbouring comuna's
-- exact point) that TEST 5 cannot, since it shares a region_num. Round 2
-- review confirmed these two are genuinely independent (Las Condes/Maipú
-- share a region_num, so only TEST 7 reddens on that mutation) and
-- measured the residual gap TEST 5 does not close: of all possible
-- cross-region swaps, ~6.9% still pass because adjacent regions overlap
-- on latitude too. Closing that fully needs point-in-polygon, and
-- `geometry` staying NULL is a declared Non-Goal -- not chased here.

BEGIN;
SELECT plan(8);

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

-- ── TEST 4 -- sanity check on the other side of the OR: the three
--             documented exceptions really do fall outside that same
--             mainland box, so TEST 3 is not vacuously true because
--             nothing was ever excluded ───────────────────────────────────
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

-- ── TEST 5 -- every mainland centroid's latitude falls inside its own
--             region's real latitude band -- catches a cross-region swap
--             (e.g. 15101 Arica <-> 12101 Punta Arenas) that TEST 3's
--             single wide box cannot, because both points are individually
--             valid Chilean coordinates ───────────────────────────────────
-- Bands were computed off this migration's first-committed seed (fase 2
-- round 1 review), widened by ±0.5° slack. They have since loosened
-- slightly in one direction only: round 2's `12302` correction moved that
-- row to -51.26, but region 12's real northern extreme is `12301` Natales
-- at -51.73, so the band's -51.08 upper bound is now ~1.15° looser than
-- the live data's actual max -- never tighter, so it cannot produce a
-- false positive, only a slightly wider true-negative margin. Re-deriving
-- the bands on every data edit is not required for that reason; TEST 6
-- below guards against the one failure mode loosening the *values* alone
-- cannot cause -- a `region_num` silently missing from this list entirely.
-- 05201/05104 (region 5) and 12202 (region 12) are excluded, same as
-- TEST 3/4 -- they are documented exceptions, not band members.
SELECT is(
  (
    SELECT COUNT(*)::int
      FROM public.chile_comunas c
      JOIN (VALUES
        (15, -18.97, -17.83), (1,  -20.50, -19.27), (2,  -25.41, -21.22),
        (3,  -28.76, -26.34), (4,  -31.92, -29.51), (5,  -33.79, -32.25),
        (6,  -34.73, -33.95), (7,  -36.15, -34.87), (16, -37.12, -36.13),
        (8,  -38.35, -36.61), (9,  -39.38, -37.67), (14, -40.34, -39.45),
        (10, -43.62, -40.41), (11, -48.48, -43.91), (12, -55.16, -51.08),
        (13, -34.04, -33.09)
      ) AS b(region_num, lat_min, lat_max)
        ON c.region_num = b.region_num
     WHERE c.codigo_cut NOT IN ('05201', '05104', '12202')
       AND NOT (c.centroid_lat BETWEEN b.lat_min - 0.5 AND b.lat_max + 0.5)
  ),
  0,
  'every comuna centroid latitude falls within its own region''s real latitude band (±0.5° slack)'
);

-- ── TEST 6 -- TEST 5's JOIN engages all 344 non-exception rows, not a
--             silent subset ───────────────────────────────────────────────
-- An inner JOIN skips a row whose region_num never appears on the left
-- side of the VALUES list -- silently, in green, exactly the shape this
-- repo has been burned by before (a guard passing because it never saw
-- the row at all). 347 total minus the 3 documented exceptions
-- (05201, 05104, 12202) is 344; this pins that count so a future
-- region_num added to chile_comunas without a matching band entry goes
-- red here instead of vanishing from TEST 5's count.
SELECT is(
  (
    SELECT COUNT(*)::int
      FROM public.chile_comunas c
      JOIN (VALUES
        (15, -18.97, -17.83), (1,  -20.50, -19.27), (2,  -25.41, -21.22),
        (3,  -28.76, -26.34), (4,  -31.92, -29.51), (5,  -33.79, -32.25),
        (6,  -34.73, -33.95), (7,  -36.15, -34.87), (16, -37.12, -36.13),
        (8,  -38.35, -36.61), (9,  -39.38, -37.67), (14, -40.34, -39.45),
        (10, -43.62, -40.41), (11, -48.48, -43.91), (12, -55.16, -51.08),
        (13, -34.04, -33.09)
      ) AS b(region_num, lat_min, lat_max)
        ON c.region_num = b.region_num
     WHERE c.codigo_cut NOT IN ('05201', '05104', '12202')
  ),
  344,
  'TEST 5''s region-band JOIN covers all 344 non-exception rows (347 - 3), not a silently-narrowed subset'
);

-- ── TEST 7 -- no two comunas share the exact same centroid point ──────────
-- A copy-paste from a neighbouring row (e.g. Las Condes given Maipú's
-- point) would be a real, in-region, in-band coordinate and pass every
-- test above -- this is the only assertion that would catch it.
SELECT is(
  (
    SELECT COUNT(*)::int
      FROM (
        SELECT centroid_lat, centroid_lng
          FROM public.chile_comunas
         GROUP BY centroid_lat, centroid_lng
        HAVING COUNT(*) > 1
      ) dupes
  ),
  0,
  'no two chile_comunas rows share the exact same centroid point'
);

-- ── TEST 8 -- the hand-picked provincia row (14201 Ranco) got a real,
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
ROLLBACK;
