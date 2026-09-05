/**
 * Coordinator finding, post-Fase-3 (spec-79 Fase 4): `routes.external_route_id`
 * is `NOT NULL` (20260306000001_add_routes_dispatches_fleet_tables.sql:82),
 * and both places a route is ever created pre-fill it with a placeholder
 * BEFORE DispatchTrack has seen the route:
 *  - `create_seeded_route` (Pre-Ruta), latest definition
 *    20260903000002_spec72_phase2_default_route_blocks.sql:255 —
 *    `v_external_id := 'draft_' || gen_random_uuid()::text;`
 *  - `POST /api/dispatch/routes` (route.ts:146) —
 *    `` const draftExternalId = `draft_${crypto.randomUUID()}` ``
 *
 * `dispatch/route.ts`'s retry-skip branch used a bare
 * `Boolean(route.external_route_id)` to decide "DT already accepted this
 * route on an earlier attempt" — which is true for every route the moment
 * it is CREATED, long before anyone dispatches it. Every real dispatch took
 * the retry path: it never called DT, persisted the placeholder as if it
 * were DT's own id, transitioned the route to `dispatched`, and answered
 * `200 {ok:true}`. DispatchTrack never received the route.
 *
 * `LoadingRouteCard.tsx` already carried the same `startsWith('draft_')`
 * check for display purposes (it falls back to the route's short id instead
 * of showing the raw placeholder slug as a headline) — this extracts that
 * same test so the two call sites read one definition of "confirmed",
 * rather than two copies of the same magic prefix that can drift apart.
 *
 * A migration to make the column nullable (and have both creation paths
 * leave it `NULL`) was considered and rejected for this fix: it would also
 * need a backfill of every existing `draft_*` row in production before this
 * bug is actually closed there — an unmeasured, unbounded scope for a
 * defect that needs to stop happening now. The prefix check fixes every
 * existing production row instantly, with no migration and no backfill; a
 * future spec can still relax the column to `NULL` as a separate, purely
 * additive cleanup without this fix depending on it.
 */
const DRAFT_EXTERNAL_ROUTE_ID_PREFIX = 'draft_';

/** True only for a value DispatchTrack itself returned from Create Route —
 * never for the pre-fill placeholder every route carries at creation. */
export function isConfirmedExternalRouteId(
  externalRouteId: string | null | undefined,
): boolean {
  return Boolean(externalRouteId) && !externalRouteId!.startsWith(DRAFT_EXTERNAL_ROUTE_ID_PREFIX);
}
