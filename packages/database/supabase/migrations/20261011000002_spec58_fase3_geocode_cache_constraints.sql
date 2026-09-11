-- spec-58 fase 3: close the gap fase 1 left open on `public.geocode_cache`
-- -- no CHECK constraints (no range, no null-island, geocode_precision
-- without its enum) and no trigger maintaining `updated_at`.
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 3")

BEGIN;

-- CHECK constraints named explicitly and each guarded by its own
-- `IF NOT EXISTS (SELECT ... pg_constraint)`, matching fase 1's own
-- idempotent-CHECK convention (20261010000001) rather than a bare
-- `ADD CONSTRAINT` list, which dies with 42710 on replay.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.geocode_cache'::regclass
       AND conname  = 'geocode_cache_precision_check'
  ) THEN
    ALTER TABLE public.geocode_cache
      ADD CONSTRAINT geocode_cache_precision_check
        CHECK (geocode_precision IN ('exact', 'approximate'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.geocode_cache'::regclass
       AND conname  = 'geocode_cache_lat_lng_range_check'
  ) THEN
    ALTER TABLE public.geocode_cache
      ADD CONSTRAINT geocode_cache_lat_lng_range_check
        CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
  END IF;

  -- Only catches the (0,0) null-island case, same scope as
  -- orders_geocode_lat_lng_null_island_check (20261010000001) -- it does
  -- NOT catch a transposed-but-valid pair.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.geocode_cache'::regclass
       AND conname  = 'geocode_cache_lat_lng_null_island_check'
  ) THEN
    ALTER TABLE public.geocode_cache
      ADD CONSTRAINT geocode_cache_lat_lng_null_island_check
        CHECK (NOT (latitude = 0 AND longitude = 0));
  END IF;
END $$;

-- `updated_at` had no trigger maintaining it since fase 1. Reuse the
-- repo's existing `public.set_updated_at()` -- most recently defined at
-- 20260318000005:22 (identical body to its original 20260223000001
-- definition; citing the latest per this repo's own CREATE OR REPLACE
-- convention) -- rather than inventing a second one.
--
-- DECISION (review finding, "lower severity but cheap"): `updated_at` and
-- `last_used_at` must stay two different signals, not one column wearing
-- two names. `last_used_at` means "last time this row satisfied a cache
-- lookup" (a popularity/heat signal, bumped by lookupGeocodeCache on every
-- hit). `updated_at` means "last time this row's cached coordinate data
-- was itself written" -- the signal fase 1 says would let a future cleanup
-- target rows by when their DATA went stale, independent of how often
-- they get read. A blanket `BEFORE UPDATE` would make every cache hit
-- also bump `updated_at`, destroying that distinction (a row read a
-- thousand times would look "just written" even though its coordinate was
-- computed once, years ago). Scoping to `UPDATE OF` the substantive
-- columns keeps the hit_count/last_used_at bump from touching it. In
-- practice, given insertExactGeocodeCache's upsert+ignoreDuplicates
-- (fase 3), these columns are never touched again after their initial
-- insert -- this trigger only matters for a hypothetical future
-- correction path.
DROP TRIGGER IF EXISTS geocode_cache_set_updated_at ON public.geocode_cache;
CREATE TRIGGER geocode_cache_set_updated_at
  BEFORE UPDATE OF latitude, longitude, geocode_source, geocode_precision, normalisation_version
  ON public.geocode_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
