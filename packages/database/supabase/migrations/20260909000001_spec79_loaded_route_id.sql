-- =============================================================================
-- spec-79 BLOCKER — a box loaded on route B lands on route A's DispatchTrack
-- manifest and is marked `en_ruta` by A.
--
-- Root cause: `packages` carries no route linkage at all (dispatch-load-
-- state.ts's own header already said so). `isGenuinelyLoadedPackage` (the
-- shared predicate `buildItems`/`loadedPackageIds` both use) could only ever
-- answer "was this box scanned onto A truck", never "onto THIS truck".
-- Before spec-77 phase 1b (force-split) that gap was unreachable —
-- `ownsTheOrder` (scan-validator.ts) refused a second live dispatch for the
-- same order on any active route, so two routes could never both hold a
-- live claim on the same order at once. force-split's `stage = 'force_split'`
-- deliberately opts OUT of that guard (the whole point: the unscanned half
-- of a split order must be re-plannable onto another route), so an order can
-- now legitimately carry two live dispatches — one per route — at the same
-- time. `packages.loaded_at`/`load_inferred` are still a fact about the BOX,
-- not about which of those two routes physically holds it.
--
-- Fix: give the load fact the route linkage it was always missing.
-- `loaded_route_id` is written by the one place a box's load fact is ever
-- set by a genuine scan — `advancePackagesToEnCarga`
-- (apps/frontend/src/lib/dispatch/stage-dispatch.ts) — alongside
-- `loaded_at`/`loaded_by`/`load_inferred`. `isGenuinelyLoadedPackage` (app
-- layer, same PR) now also requires `loaded_route_id = :routeId`, so
-- `buildItems` and `loadedPackageIds` for route A can no longer see a box
-- whose `loaded_route_id` is B.
--
-- Two other candidates were considered and rejected:
--   - `dock_scans`: does carry a de-facto location, but nothing in the
--     `/routes/[id]/scan` path (the truck-loading scan) writes a `dock_scans`
--     row at all — that table is the reception/andén-sorting flow's own
--     audit trail (dock-scan-validator.ts, quicksort-exception.ts), a
--     different domain concept with its own `batch_id`/`dock_zone_id`
--     shape. Repurposing it here would be a bigger, riskier change for no
--     benefit over a purpose-built column.
--   - Freezing the force_split row's item set at seal time: the natural
--     place to do that is `seal-route.ts`/`force-seal-split.ts`, both
--     explicitly off-limits for this task (another agent is editing them on
--     a different branch for an unrelated `retorno_hub` regression).
--
-- No backfill for the general case (deliberate, matching spec-74's own
-- load_inferred precedent): a package genuinely loaded by a real scan
-- BEFORE this migration ships has no way to recover which route did it after
-- the fact once an order has more than one live dispatch — the exact
-- ambiguity this migration exists to resolve going forward, not backwards.
-- The narrow backfill below covers only the UNAMBIGUOUS case (an order with
-- exactly one live, non-deleted dispatch at migration time), where the route
-- linkage is not a guess. Every other genuinely-loaded package is left with
-- `loaded_route_id IS NULL`: `isGenuinelyLoadedPackage` then answers "not
-- genuinely loaded onto THIS route" for it until it is re-scanned — a false
-- negative (undercounts, refuses to state), never a false positive (never
-- puts a box on a manifest it did not load onto). Same tradeoff spec-79
-- phase 1c already made and documented for `load_inferred`, applied here to
-- the same discriminator's newest column.
-- =============================================================================

BEGIN;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS loaded_route_id UUID REFERENCES public.routes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.packages.loaded_route_id IS
  'spec-79 BLOCKER. Which route''s /scan physically loaded this box, set '
  'alongside loaded_at/loaded_by/load_inferred by advancePackagesToEnCarga '
  '(stage-dispatch.ts) on a genuine scan. NULL for a box never scanned, for '
  'one only ever touched by spec-74''s optimistic backfill (load_inferred = '
  'true carries no route evidence either), or for a genuine pre-migration '
  'scan on an order that was ambiguous at backfill time (see this file''s '
  'header). isGenuinelyLoadedPackage (dispatch-load-state.ts) requires this '
  'to equal the route asking "did I load this box", not merely that some '
  'route did — the fix for the force-split cross-route manifest defect.';

-- Same idempotency guard style as idx_packages_order_unloaded
-- (20260901000001): narrow, matches exactly what the app-layer predicate
-- filters on.
CREATE INDEX IF NOT EXISTS idx_packages_loaded_route_id
  ON public.packages (loaded_route_id)
  WHERE loaded_route_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Narrow backfill — unambiguous orders only (see header for why anything
-- ambiguous is deliberately left NULL rather than guessed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spec79_backfill_loaded_route_id()
RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
DECLARE
  backfilled BIGINT;
BEGIN
  UPDATE public.packages p
     SET loaded_route_id = d.route_id
    FROM (
      SELECT order_id, MIN(route_id::text)::uuid AS route_id, COUNT(*) AS live_count
        FROM public.dispatches
       WHERE deleted_at IS NULL
       GROUP BY order_id
      HAVING COUNT(*) = 1
    ) d
   WHERE d.order_id        = p.order_id
     AND p.deleted_at      IS NULL
     AND p.loaded_at       IS NOT NULL
     AND p.load_inferred   = false
     AND p.loaded_route_id IS NULL;
  GET DIAGNOSTICS backfilled = ROW_COUNT;
  RETURN backfilled;
END;
$fn$;

COMMENT ON FUNCTION public.spec79_backfill_loaded_route_id() IS
  'spec-79 BLOCKER. One-time backfill of loaded_route_id, scoped to orders '
  'that carry exactly one live dispatch at migration time (the route '
  'linkage is then unambiguous, not a guess). Extracted into a function, '
  'same reasoning as spec74_backfill_package_load_state: the pgTAP suite '
  'calls this exact function against its own fixtures rather than pasting '
  'a second copy of the UPDATE that could drift from what this migration '
  'runs. Deliberately NOT invoked by this migration (see below) — call it '
  'by hand, after measuring, the same discipline spec-74''s Decision 5 and '
  'this spec''s own Fase 1 item 7 already require for this exact table pair '
  'at production scale (~112k dispatches / ~61k packages).';

-- Deliberately NOT auto-run here, unlike spec74_backfill_package_load_state
-- (20260901000001), which DOES invoke its own backfill inline. That
-- migration's backfill only ever writes onto a `staged`/`adopted` dispatch's
-- packages -- a bounded, already-small subset. This one's source query
-- aggregates the FULL `dispatches` table (GROUP BY order_id) before joining
-- back to `packages`, and this spec's own Riesgos section already documents
-- two prior migrations in this series that hit statement_timeout at this
-- table's production scale. Running it unmeasured, inside a migration that
-- must complete for the release to proceed, is exactly the failure mode
-- those two incidents warn against. Call
-- `SELECT public.spec79_backfill_loaded_route_id();` by hand once someone
-- with production access has measured how many rows it would touch.

COMMIT;
