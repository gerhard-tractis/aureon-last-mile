-- spec-58 fase 1: `orders` geocode columns, the geocode work-queue index,
-- the address-change reset trigger, and `public.geocode_cache`.
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 1")
--
-- No UI, no network calls, no provider adapter land here -- see the spec
-- for the phases that consume this schema (2-7).

-- ============================================================================
-- PART 1: `orders` geocode columns
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_source TEXT;      -- 'maptiler' | 'comuna_centroid'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_precision TEXT;   -- 'exact' | 'approximate'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_status TEXT NOT NULL DEFAULT 'pending';
                                                  -- 'pending' | 'resolved' | 'fallback' | 'unresolvable'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_last_attempt_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_next_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.geocode_next_attempt_at IS
  'Due time for the next geocode retry (spec-58 fase 5). Without this the '
  'claim query cannot space attempts, and a short-cron/outage combination '
  'would march a whole day of orders to a permanent centroid.';

-- CHECK constraints are named explicitly: fase 1's pgTAP suite asserts on
-- the constraint name, and a later reader needs to be able to tell which
-- rule an INSERT tripped without re-deriving it from the expression.
ALTER TABLE public.orders
  ADD CONSTRAINT orders_geocode_precision_check
    CHECK (geocode_precision IN ('exact', 'approximate')),
  ADD CONSTRAINT orders_geocode_status_check
    CHECK (geocode_status IN ('pending', 'resolved', 'fallback', 'unresolvable')),
  -- Both NULL (never geocoded) or both set -- never one without the other.
  ADD CONSTRAINT orders_geocode_lat_lng_pair_check
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  -- NULL AND/OR NULL evaluates to NULL, and a CHECK only rejects a row when
  -- the expression is FALSE -- so an ungeocoded (NULL, NULL) row always
  -- passes this range check without needing an explicit "OR latitude IS NULL".
  ADD CONSTRAINT orders_geocode_lat_lng_range_check
    CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
  -- A provider bug writing null-island, or a swapped lat/lng pair, must
  -- never reach the map.
  ADD CONSTRAINT orders_geocode_lat_lng_null_island_check
    CHECK (NOT (latitude = 0 AND longitude = 0));

-- Work-queue index, leading on the due-time column so the claim query's
-- predicate and ordering both use it (spec-58 fase 5).
--
-- Postgres defaults ASC to NULLS LAST, so the fase-5 claim query's
-- `ORDER BY geocode_next_attempt_at NULLS FIRST, created_at` must be written
-- verbatim (matching this index) or the index will not be used. Untried
-- orders have a NULL due-time and therefore must sort first, ahead of
-- orders whose retry window has not yet arrived.
CREATE INDEX IF NOT EXISTS idx_orders_geocode_queue
  ON public.orders (geocode_next_attempt_at NULLS FIRST, created_at)
  WHERE geocode_status IN ('pending', 'fallback') AND deleted_at IS NULL;

-- ============================================================================
-- PART 2: Re-geocode on address/comuna change
-- ============================================================================
--
-- orders.delivery_address is editable and nothing today would notice --
-- without this, an edited address silently keeps the pin of the address it
-- replaced, which is worse than no pin because it looks correct.
CREATE OR REPLACE FUNCTION public.orders_geocode_reset()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
     OR NEW.comuna_id IS DISTINCT FROM OLD.comuna_id THEN
    NEW.latitude := NULL;
    NEW.longitude := NULL;
    NEW.geocoded_at := NULL;
    NEW.geocode_source := NULL;
    NEW.geocode_precision := NULL;
    NEW.geocode_status := 'pending';
    NEW.geocode_attempts := 0;
    NEW.geocode_next_attempt_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- HARD REQUIREMENT, NOT COSMETICS: Postgres fires same-event BEFORE triggers
-- in alphabetical name order. `orders_normalize_comuna_trigger`
-- (20260321000001:523-527) is BEFORE INSERT OR UPDATE OF comuna, and its
-- function both derives NEW.comuna_id AND rewrites NEW.comuna to the
-- canonical name (20260321000001:512-517). Neither column is safe to
-- compare before that trigger has run:
--   - comparing comuna_id too early -> it is not yet written, reset no-ops;
--   - comparing raw comuna too late -> already canonicalised, so it equals
--     OLD.comuna for any case/accent variant, and the reset no-ops.
-- The `zz` prefix forces this trigger to sort AFTER
-- `orders_normalize_comuna_trigger` (`orders_n...` < `orders_zz...`), so
-- that by the time this function runs, comuna_id already reflects the new
-- value and is the right thing to compare. ANY FUTURE RENAME OF THIS
-- TRIGGER MUST PRESERVE THAT ORDERING -- spec58_geocoding.sql's "zz-ordering"
-- test is the one that catches a regression here.
DROP TRIGGER IF EXISTS orders_zz_geocode_reset ON public.orders;
CREATE TRIGGER orders_zz_geocode_reset
  BEFORE UPDATE OF delivery_address, comuna ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_geocode_reset();

-- ============================================================================
-- PART 3: `public.geocode_cache`
-- ============================================================================
--
-- Deliberately NOT operator_id-scoped: a street address resolves to the
-- same point regardless of tenant, and partitioning per operator would
-- multiply paid geocoder lookups by the number of tenants. The key is
-- derived from customer address data, though, so this is not a table of
-- "public facts" -- three mitigations, all required:
--   1. The key is stored ONLY as a sha256 hash, never as plaintext.
--   2. RLS on, no client-facing policy, plus an explicit REVOKE below.
--   3. The frontend must never query this table -- only the service role
--      (the agents worker) touches it.
--
-- Deliberately has no deleted_at: this is a derived, rebuildable cache with
-- no business record attached, a documented exception to the project's
-- soft-deletes-only rule.
CREATE TABLE IF NOT EXISTS public.geocode_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_hash TEXT NOT NULL,                 -- sha256 of the normalised street|comuna key
  normalisation_version SMALLINT NOT NULL,    -- bumped when fase 3's normalisation rules change
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  geocode_source TEXT NOT NULL,
  geocode_precision TEXT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (address_hash, normalisation_version)
);

COMMENT ON TABLE public.geocode_cache IS
  'Street-level geocode cache, deliberately not operator_id-scoped and '
  'without deleted_at -- see spec-58 fase 1 for the reasoning and mitigations.';
COMMENT ON COLUMN public.geocode_cache.normalisation_version IS
  'A column, not a hash input: the hash covers only the normalised string, '
  'so two versions of one address can coexist instead of colliding.';

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geocode_cache FROM anon, authenticated;
