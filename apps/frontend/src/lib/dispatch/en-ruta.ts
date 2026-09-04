import type { RouteStatus } from './types';

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

/**
 * Raw row this module needs from `routes`.
 *
 * Deliberately absent: `planned_stops` (spec-70's own migration comment,
 * `20260825000002:162`, says it "drifts by construction… nothing local
 * should read it" — DispatchTrack writes it from the provider's own count,
 * a different number than what this module counts locally from
 * `dispatches`) and `completed_stops` (selected once, never read by
 * anything downstream — dropped rather than left as a trap for a future
 * "isn't this the PARADAS field?" guess).
 */
export interface RawRouteRow {
  id: string;
  external_route_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  status: RouteStatus;
  /** Needed here (unlike `planned_stops`/`completed_stops`) to split one
   * week-bounded completed-routes read into "hoy" (the foot section) and
   * "esta semana" (the standalone Completadas tab) without a second query. */
  route_date: string;
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
  routeDate: string;
  comunas: string[];
  /** = this route's dispatch count, counted locally — never
   * `routes.planned_stops` (see `RawRouteRow`'s doc). Numerator
   * (`paradasCompletadas`) and denominator now come from the same source,
   * so they can't drift apart into something like `13/8`. */
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

/** Groups a flat dispatch list by `route_id` once, so `buildEnRutaRoute`
 * never re-scans the full list per route (was O(routes × dispatches)). A
 * dispatch with no `route_id` is dropped — it cannot belong to any row
 * here. */
export function groupDispatchesByRoute(dispatches: RawDispatchRow[]): Map<string, RawDispatchRow[]> {
  const byRoute = new Map<string, RawDispatchRow[]>();
  for (const d of dispatches) {
    if (!d.route_id) continue;
    const list = byRoute.get(d.route_id);
    if (list) list.push(d);
    else byRoute.set(d.route_id, [d]);
  }
  return byRoute;
}

/** Builds one `EnRutaRoute` from a route row and the dispatches that
 * already belong to it (pre-grouped by `groupDispatchesByRoute` — this
 * function does no filtering of its own). `orderComunas` maps `order_id` →
 * `orders.comuna` for exactly the orders this route's dispatches
 * reference. */
export function buildEnRutaRoute(
  route: RawRouteRow,
  routeDispatches: RawDispatchRow[],
  orderComunas: Map<string, string>,
  vehicleIdentifiers: Map<string, string | null>,
): EnRutaRoute {
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
    routeDate: route.route_date,
    comunas: Array.from(comunaSet).sort((a, b) => a.localeCompare(b, 'es')),
    paradasTotal: routeDispatches.length,
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
  // Verified (phase-5 review): no path seeds `estimated_at` at dispatch
  // time — our own POST /dispatch call does not write it (createDTRoute's
  // response is `{ external_route_id }` only). It is written by the
  // inbound DispatchTrack webhook (beetrack-webhook upserts it from every
  // dispatch event) and by dispatchtrack-route-poll — but the poll only
  // re-fetches routes already at status `in_progress`, not `dispatched`,
  // so it cannot backfill a route the instant it appears on `1d`. A route
  // freshly dispatched has `estimated_at = NULL` on every stop until DT's
  // first webhook lands; `otifPct: null` (nothing rendered) is therefore
  // the NORMAL state right after dispatch, not a rare edge case — it
  // should fill in over the route's life as webhooks/polls land.
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
 * and no event for 41 minutes belongs at the top.
 *
 * The three `lastEventAt` cases are explicit (both null / only `a` null /
 * only `b` null / neither null) rather than coercing null to `-Infinity`
 * and subtracting — `-Infinity - -Infinity` is `NaN`, which `Array.sort`
 * happens to treat as "equal" on this engine but is not a documented,
 * portable comparator result. */
export function compareEnRutaIncidence(a: EnRutaRoute, b: EnRutaRoute): number {
  if (a.fallidas !== b.fallidas) return b.fallidas - a.fallidas;
  if (a.lastEventAt === null && b.lastEventAt === null) return 0;
  if (a.lastEventAt === null) return -1; // no event at all is maximally stale — sorts first
  if (b.lastEventAt === null) return 1;
  return new Date(a.lastEventAt).getTime() - new Date(b.lastEventAt).getTime();
}

export function sortEnRutaRoutes(routes: EnRutaRoute[]): EnRutaRoute[] {
  return [...routes].sort(compareEnRutaIncidence);
}

/** "hace 41 min" / "hace 8 s" / "hace 5 h 40 min" / "sin eventos". Rolls
 * over to hours past 60 minutes — a route dispatched at the start of a
 * shift must not read "hace 340 min" on a screen meant to be read across a
 * whole shift, not just during a stall. `nowMs` is supplied by the
 * caller's own tick (rule 9) — this function itself is pure. */
export function formatLastEventLabel(lastEventAtIso: string | null, nowMs: number): string {
  if (!lastEventAtIso) return 'sin eventos';
  const deltaMs = Math.max(0, nowMs - new Date(lastEventAtIso).getTime());
  if (deltaMs < 60_000) return `hace ${Math.floor(deltaMs / 1000)} s`;
  const totalMinutes = Math.floor(deltaMs / 60_000);
  if (totalMinutes < 60) return `hace ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `hace ${hours} h` : `hace ${hours} h ${minutes} min`;
}

/** `dateISO` minus `days` civil days, as `YYYY-MM-DD`. Pure calendar
 * arithmetic on a date-only string (parsed at UTC midnight) — safe
 * regardless of the caller's timezone because there is no time-of-day
 * component to misinterpret, unlike `new Date()` "now" math. Used to floor
 * both route cohorts to the last 7 days (I4) instead of scanning every
 * route ever stranded on the road. */
export function subtractDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
