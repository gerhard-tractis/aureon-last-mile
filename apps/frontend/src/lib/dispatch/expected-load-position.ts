import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/**
 * spec-71 phase 3 — "which position should this package's package-scan
 * arm?" the staging pass's analogue of `determineDockZone` (the pure
 * comuna->andén suggestion `useQuickSortFlow` already shows before the
 * confirming andén scan). Unlike `determineDockZone` this needs a DB round
 * trip: the destination is "whichever position the package's already-
 * `planned` route currently occupies", not a fact computable from the
 * package alone.
 */

export interface ExpectedLoadPosition {
  dispatchId: string;
  routeId: string;
  positionId: string;
  positionCode: string;
  positionLabel: string | null;
}

interface LoadPositionRow {
  id: string;
  code: string;
  label: string | null;
  deleted_at: string | null;
}

interface RouteRow {
  id: string;
  load_position_id: string | null;
  load_position_released_at: string | null;
  deleted_at: string | null;
  load_positions: LoadPositionRow | LoadPositionRow[] | null;
}

export interface DispatchWithRouteRow {
  id: string;
  route_id: string | null;
  routes: RouteRow | RouteRow[] | null;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Pure: which of these `dispatches` rows sits on a route that currently
 * occupies a live position. Decision 4's occupancy predicate, verbatim:
 * `load_position_id IS NOT NULL AND load_position_released_at IS NULL AND
 * deleted_at IS NULL` on the route, plus the position itself not
 * soft-deleted (dock_zones' dangling-FK contract, Decision 7, applies the
 * same way here: a stale reference must not be read as "occupied").
 */
export function pickOccupiedPosition(rows: readonly DispatchWithRouteRow[]): ExpectedLoadPosition | null {
  for (const row of rows) {
    const route = firstOf(row.routes);
    if (!route || route.deleted_at) continue;
    if (!route.load_position_id || route.load_position_released_at) continue;
    const position = firstOf(route.load_positions);
    if (!position || position.deleted_at) continue;
    return {
      dispatchId: row.id,
      routeId: route.id,
      positionId: position.id,
      positionCode: position.code,
      positionLabel: position.label,
    };
  }
  return null;
}

export type FindExpectedLoadPositionResult =
  | { ok: true; position: ExpectedLoadPosition }
  | { ok: false; code: 'NO_POSITION_ASSIGNED' | 'QUERY_FAILED'; message: string };

/**
 * Looks up the position the staging scan should expect for this package's
 * order: its `planned` dispatch, and the position (if any) the dispatch's
 * route currently occupies. `NO_POSITION_ASSIGNED` covers both "no planned
 * dispatch at all" and "planned, but the route has no position yet"
 * (Decision 8's best-effort assignment means that is a normal, not an
 * exceptional, state) — the caller shows the same "cannot stage yet"
 * message either way.
 */
export async function findExpectedLoadPosition(
  supabase: SupabaseClient<Database>,
  input: { operatorId: string; orderId: string },
): Promise<FindExpectedLoadPositionResult> {
  const { data, error } = await supabase
    .from('dispatches')
    .select(
      'id, route_id, routes!dispatches_route_id_fkey(id, load_position_id, load_position_released_at, deleted_at, load_positions(id, code, label, deleted_at))',
    )
    .eq('operator_id', input.operatorId)
    .eq('order_id', input.orderId)
    .eq('stage', 'planned')
    .is('deleted_at', null)
    .limit(50);

  if (error) {
    return { ok: false, code: 'QUERY_FAILED', message: `No se pudo validar la posición: ${error.message}` };
  }

  const position = pickOccupiedPosition((data ?? []) as unknown as DispatchWithRouteRow[]);
  if (!position) {
    return {
      ok: false,
      code: 'NO_POSITION_ASSIGNED',
      message: 'Esta ruta aún no tiene una posición asignada',
    };
  }

  return { ok: true, position };
}
