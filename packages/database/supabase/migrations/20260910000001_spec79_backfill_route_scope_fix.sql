-- =============================================================================
-- spec-79 Fase 1g (H-2, HIGH) — spec79_backfill_loaded_route_id() counted rows,
-- not routes, and never looked at whether a dispatch's own route was still
-- alive.
--
-- `CREATE OR REPLACE`: template is 20260909000001 (the migration that first
-- defined this function, and still the latest one to touch it) — never the
-- original, per repo rule, because 20260909000001 IS the original for this
-- function and no later migration has replaced it yet.
--
-- Two defects in the source query, both against production's ~112k
-- dispatches / ~61k packages, where this table pair has already caused two
-- statement_timeout incidents in this series:
--
-- 1. `HAVING COUNT(*) = 1` skipped an order with two live dispatch ROWS on
--    the SAME route. Two live dispatches per order are explicitly permitted
--    (no unique constraint — 20260901000001:181-183, the same fact that
--    forces loadedPackageIds' own dedupe at the app layer), and when both
--    rows agree on route_id the linkage is not a guess — it is the one
--    route this narrow backfill exists to write. Fixed: group on
--    `COUNT(DISTINCT route_id) = 1`, not `COUNT(*) = 1`.
--
-- 2. The subquery filtered only `dispatches.deleted_at IS NULL` — never the
--    STATE of the route each dispatch points at. An order with a dispatch
--    on a route `completed` weeks ago (still deleted_at IS NULL — routes/
--    dispatches are never hard-deleted, and `completed` is not a soft-
--    delete) plus its current dispatch on a route actually in play gives
--    two distinct, live-row route_ids and gets skipped, even though only
--    one of those two routes is still operationally alive. Fixed: join to
--    `routes` and require `r.status IN (draft, planned, loading, loaded,
--    dispatched, in_transit, in_progress)` — the exact "active route"
--    vocabulary `get_pre_route_snapshot` already uses for the same
--    completed/cancelled-releases-the-order distinction (20260908000001,
--    routed_ids CTE) — plus `r.deleted_at IS NULL`.
--
-- Cost at production scale: the query shape is unchanged — still one
-- GROUP BY order_id sweep over the full `dispatches` table, the dominant
-- cost the two prior timeouts in this series were caused by. The added
-- JOIN is against `routes` on its primary key (indexed) and a status
-- filter on a table many orders of magnitude smaller than `dispatches`;
-- this does not make the query materially more expensive, and it does not
-- make it cheaper either. The function still is NOT auto-invoked by this
-- migration (see 20260909000001's own note) — measure, then run in
-- batches, with the old app still live, same discipline as before.
-- =============================================================================

BEGIN;

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
      SELECT dd.order_id, MIN(dd.route_id::text)::uuid AS route_id
        FROM public.dispatches dd
        JOIN public.routes r ON r.id = dd.route_id
       WHERE dd.deleted_at IS NULL
         AND r.deleted_at  IS NULL
         AND r.status IN ('draft', 'planned', 'loading', 'loaded',
                           'dispatched', 'in_transit', 'in_progress')
       GROUP BY dd.order_id
      HAVING COUNT(DISTINCT dd.route_id) = 1
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
  'spec-79 Fase 1g (H-2 fix). One-time backfill of loaded_route_id, scoped '
  'to orders that carry exactly one DISTINCT live route among their active '
  'dispatches at run time (COUNT(DISTINCT route_id) = 1, not COUNT(*) = 1 — '
  'two dispatch rows on the same route are not ambiguous). "Live" means the '
  'dispatch row is not soft-deleted AND its route is still in an active '
  'spec-70 status (draft/planned/loading/loaded/dispatched/in_transit/'
  'in_progress) — a dispatch pointing at a completed/cancelled route no '
  'longer competes for the linkage. Still deliberately NOT invoked by this '
  'migration (unchanged cost profile, same production-scale timeout risk '
  'documented in 20260909000001) — call it by hand, after measuring.';

COMMIT;
