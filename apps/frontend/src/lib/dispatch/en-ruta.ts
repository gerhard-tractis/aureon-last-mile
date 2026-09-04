import type { RouteStatus } from './types';
import { formatFreshness } from './loading-monitor';

/** dispatch_status_enum, as it lands on `dispatches.status`. */
export type EnRutaDispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

/** Raw row this module needs from `dispatches` — one per stop. */
export interface RawDispatchRow {
  route_id: string | null;
  order_id: string | null;
  status: EnRutaDispatchStatus;
  completed_at: string | null;
  estimated_at: string | null;
  updated_at: string;
}

/** Raw row this module needs from `routes`. */
export interface RawRouteRow {
  id: string;
  external_route_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  status: RouteStatus;
  route_date: string;
  planned_stops: number;
  completed_stops: number;
}

/** One row of the En ruta table — a route plus everything derived from its
 * dispatches. Every field here has a real column behind it (see
 * `useEnRutaSnapshot`) — nothing here is invented. */
export interface EnRutaRoute {
  id: string;
  externalRouteId: string | null;
  driverName: string | null;
  /** `fleet_vehicles.external_vehicle_id`, joined via `routes.vehicle_id` —
   * NOT `routes.truck_identifier`, which no query in this codebase actually
   * selects (see field-by-field diff in the phase-5 report). */
  truckIdentifier: string | null;
  status: RouteStatus;
  comunas: string[];
  paradasTotal: number;
  paradasCompletadas: number;
  fallidas: number;
  /** MAX(dispatches.updated_at) across this route's stops, or null when the
   * route has no dispatches at all. Real per-stop trigger-maintained column
   * — not `routes.updated_at`, which a sibling route's dispatch can bump
   * (spec-75 decision, "no proxy under a label asserting a fact"). */
  lastEventAt: string | null;
}

/** Header metric row — ENTREGADAS / PENDIENTES / FALLIDAS / OTIF. Computed
 * only over the on-road cohort (matches "12 rutas · 268 paradas"). */
export interface EnRutaMetrics {
  entregadas: number;
  pendientes: number;
  fallidas: number;
  /** null when no dispatch in the cohort has both a status resolution and a
   * promised time (`estimated_at`) to grade against — render nothing, not
   * a fabricated percentage. */
  otifPct: number | null;
}

const ORDER_LOOKUP_STATUSES: readonly EnRutaDispatchStatus[] = ['delivered', 'partial'];

/** Builds one `EnRutaRoute` from a route row and the dispatches that belong
 * to it. `orderComunas` maps `order_id` → `orders.comuna` for exactly the
 * orders this route's dispatches reference. */
export function buildEnRutaRoute(
  route: RawRouteRow,
  dispatches: RawDispatchRow[],
  orderComunas: Map<string, string>,
  vehicleIdentifiers: Map<string, string | null>,
): EnRutaRoute {
  const routeDispatches = dispatches.filter((d) => d.route_id === route.id);

  const comunaSet = new Set<string>();
  for (const d of routeDispatches) {
    const comuna = d.order_id ? orderComunas.get(d.order_id) : undefined;
    if (comuna) comunaSet.add(comuna);
  }

  const fallidas = routeDispatches.filter((d) => d.status === 'failed').length;
  const paradasCompletadas = routeDispatches.filter((d) =>
    d.status === 'delivered' || d.status === 'failed' || d.status === 'partial',
  ).length;

  const lastEventAt = routeDispatches.reduce<string | null>((latest, d) => {
    if (!latest) return d.updated_at;
    return d.updated_at > latest ? d.updated_at : latest;
  }, null);

  return {
    id: route.id,
    externalRouteId: route.external_route_id,
    driverName: route.driver_name,
    // fleet_vehicles.external_vehicle_id via vehicle_id — never
    // route.truck_identifier: that field exists on the DispatchRoute type
    // but no query in this codebase selects it, so it is always undefined.
    // Don't "restore" it here.
    truckIdentifier: route.vehicle_id ? (vehicleIdentifiers.get(route.vehicle_id) ?? null) : null,
    status: route.status,
    comunas: Array.from(comunaSet).sort((a, b) => a.localeCompare(b, 'es')),
    paradasTotal: route.planned_stops,
    paradasCompletadas,
    fallidas,
    lastEventAt,
  };
}

/** Header metrics — ENTREGADAS/PENDIENTES/FALLIDAS/OTIF, over one flat list
 * of dispatches (the on-road cohort only — see `EnRutaMetrics`'s doc). */
export function computeEnRutaMetrics(dispatches: RawDispatchRow[]): EnRutaMetrics {
  const entregadas = dispatches.filter((d) => d.status === 'delivered').length;
  const pendientes = dispatches.filter((d) => d.status === 'pending').length;
  const fallidas = dispatches.filter((d) => d.status === 'failed').length;

  // OTIF: on-time-in-full. "In full" = delivered, not partial. "On time" =
  // completed_at <= estimated_at. Denominator is resolved dispatches
  // (delivered/partial — a genuine outcome, not still-pending) that also
  // carry a promised time; a resolved dispatch with no estimated_at cannot
  // be graded either way and is excluded rather than counted against.
  //
  // Verified (phase-5 review): `estimated_at` is written by exactly one
  // path for a stop that hasn't resolved — the inbound DispatchTrack
  // webhook (beetrack-webhook upserts it verbatim from every dispatch
  // event it receives, confirmed against a captured payload). Our own
  // POST /dispatch call does NOT seed it — createDTRoute's response is
  // `{ external_route_id }` only — and dispatchtrack-route-poll only
  // re-polls routes already at status `in_progress`, not `dispatched`, so
  // it cannot backfill a route the instant it appears on `1d`. A route
  // freshly dispatched has `estimated_at = NULL` on every stop until DT's
  // first webhook lands; `otifPct: null` (nothing rendered) is therefore
  // the NORMAL state right after dispatch, not a rare edge case — it
  // should fill in over the route's life as webhooks arrive.
  const gradable = dispatches.filter(
    (d) => ORDER_LOOKUP_STATUSES.includes(d.status) && d.estimated_at && d.completed_at,
  );
  const onTimeInFull = gradable.filter(
    (d) => d.status === 'delivered' && d.completed_at! <= d.estimated_at!,
  ).length;
  const otifPct = gradable.length > 0
    ? Math.round((onTimeInFull / gradable.length) * 1000) / 10
    : null;

  return { entregadas, pendientes, fallidas, otifPct };
}

/** Decision 5: order by what's going wrong, not by route code. Higher
 * `fallidas` first; ties broken by staleness of `lastEventAt` — the route
 * with the oldest (or no) last event sorts first. A route with 5 failures
 * and no event for 41 minutes belongs at the top. */
export function compareEnRutaIncidence(a: EnRutaRoute, b: EnRutaRoute): number {
  if (a.fallidas !== b.fallidas) return b.fallidas - a.fallidas;
  const aTime = a.lastEventAt ? new Date(a.lastEventAt).getTime() : -Infinity;
  const bTime = b.lastEventAt ? new Date(b.lastEventAt).getTime() : -Infinity;
  return aTime - bTime; // older (smaller) timestamp first; null sorts first of all
}

export function sortEnRutaRoutes(routes: EnRutaRoute[]): EnRutaRoute[] {
  return [...routes].sort(compareEnRutaIncidence);
}

/** "hace 41 min" / "hace 8 s" / "sin eventos". `nowMs` is supplied by the
 * caller's own tick (rule 9) — this function itself is pure. */
export function formatLastEventLabel(lastEventAtIso: string | null, nowMs: number): string {
  if (!lastEventAtIso) return 'sin eventos';
  return `hace ${formatFreshness(lastEventAtIso, nowMs)}`;
}
