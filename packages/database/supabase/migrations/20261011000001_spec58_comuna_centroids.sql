-- spec-58 fase 2: comuna centroids on `public.chile_comunas` -- DDL ONLY
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 2")
--
-- `geometry` stays NULL -- this spec seeds point centroids only, no
-- polygon geometry. That is a Non-Goal (see spec-58's "Non-Goals" section).
--
-- ============================================================================
-- SPLIT FROM THE SEED MIGRATION -- DO NOT MERGE BACK TOGETHER
-- ============================================================================
--
-- The 347-row seed of these two columns lives in a SEPARATE file,
-- `20261011000003_spec58_comuna_centroids_seed.sql` (see its header for
-- full provenance, corrections and reasoning). This file is DDL only --
-- deliberately -- because `scripts/check-migration-safety-rule1.mjs` rule
-- 1 rejects a migration that mixes DDL (an `ALTER TABLE`) with a
-- top-level, unbounded `UPDATE` in the same file, and
-- `findRule1Violations` only inspects a file's UPDATE/backfill shape AT
-- ALL when that same file also contains DDL
-- (check-migration-safety-rule1.mjs:242, "Returns [] when there is no DDL
-- at all"). Splitting DDL and backfill into separate files is the rule's
-- own prescribed compliance shape, not a workaround: this file has no
-- backfill for rule 1 to ever look at, and the seed file has no DDL for
-- rule 1 to pair a backfill against.
--
-- Two migrations were tried and rejected before this one: (1) a bare
-- top-level UPDATE next to these ADD COLUMNs -- rejected outright by rule
-- 1; (2) wrapping the UPDATE in a CREATE FUNCTION invoked inline in the
-- SAME file -- this technically passed CI due to a regex detail in
-- `BODY_UPDATE_RE` (an `UPDATE ... AS c SET ...` table alias defeats its
-- `UPDATE \S+ SET` match), but a future fix to that regex would silently
-- flip this migration from compliant to violating, and the alias
-- dependency was never intentional. This two-file split does not depend
-- on any such detail: rule 1's own first branch exits before ever
-- reaching the backfill-detection logic that regex lives in.
--
-- The 347-row seed has no production-scale backfill risk (`chile_comunas`
-- is a fixed reference table, not a live operational one) -- the split
-- exists to satisfy the rule as written, not because this specific UPDATE
-- needed splitting from a risk standpoint.

BEGIN;

ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lat DECIMAL(10,7);
ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lng DECIMAL(10,7);

COMMENT ON COLUMN public.chile_comunas.centroid_lat IS
  'Comuna centroid latitude, seeded from OSM/Nominatim (spec-58 fase 2, '
  'seed migration 20261011000003). Used as the fallback pin for an order '
  'whose address cannot be geocoded to street level -- see '
  'orders.geocode_source = ''comuna_centroid''.';
COMMENT ON COLUMN public.chile_comunas.centroid_lng IS
  'Comuna centroid longitude -- see centroid_lat for provenance.';

COMMIT;
