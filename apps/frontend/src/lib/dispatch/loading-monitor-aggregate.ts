// apps/frontend/src/lib/dispatch/loading-monitor-aggregate.ts
//
// spec-75 phase 3 — pure row-shaping for the En carga monitor. Same split
// as useRoutePackages.ts (dispatches -> order_id -> packages, two round
// trips because packages has no direct FK to dispatches), except aggregated
// across every open route at once instead of one routeId at a time, and
// additionally grouped per scanning user for the "Cuadrillas activas"
// panel. Kept dependency-free (no Supabase types) so it is testable without
// mocking a client, and reusable from the hook that does the fetching.

import { DISPATCHABLE_STATUSES } from './scan-validator';

export interface DispatchLinkRow {
  id: string;
  route_id: string | null;
  order_id: string | null;
}

export interface PackageLoadRow {
  order_id: string;
  loaded_at: string | null;
  loaded_by: string | null;
  status: string;
}

export interface RoutePackageAgg {
  total: number;
  loaded: number;
  firstScanAtIso: string | null;
  lastScanAtIso: string | null;
}

/** order_id -> route_id, first dispatch wins. An order has at most one live
 *  dispatch on an open route in practice; a duplicate is defensively
 *  resolved the same "first wins" way useRoutePackages already accepts. */
function routeIdByOrder(dispatches: readonly DispatchLinkRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of dispatches) {
    if (d.order_id && d.route_id && !map.has(d.order_id)) {
      map.set(d.order_id, d.route_id);
    }
  }
  return map;
}

/**
 * Per-route box counts and scan timestamps, from raw `dispatches` +
 * `packages` rows. Mirrors useRoutePackages.ts's per-order counting rule
 * exactly (a package counts if it is loaded OR still DISPATCHABLE_STATUSES;
 * a dañado/retenido/entregado box that was never loaded counts toward
 * neither total nor loaded), just rolled up to route level instead of
 * order level, and additionally tracking earliest/latest `loaded_at` per
 * route for the freshness and rate figures.
 */
export function aggregatePackagesByRoute(
  dispatches: readonly DispatchLinkRow[],
  packages: readonly PackageLoadRow[],
): Map<string, RoutePackageAgg> {
  const byOrder = routeIdByOrder(dispatches);
  const out = new Map<string, RoutePackageAgg>();

  for (const p of packages) {
    const routeId = byOrder.get(p.order_id);
    if (!routeId) continue;

    const dispatchable = (DISPATCHABLE_STATUSES as readonly string[]).includes(p.status);
    if (!p.loaded_at && !dispatchable) continue;

    const agg = out.get(routeId) ?? { total: 0, loaded: 0, firstScanAtIso: null, lastScanAtIso: null };
    agg.total += 1;
    if (p.loaded_at) {
      agg.loaded += 1;
      if (!agg.firstScanAtIso || Date.parse(p.loaded_at) < Date.parse(agg.firstScanAtIso)) {
        agg.firstScanAtIso = p.loaded_at;
      }
      if (!agg.lastScanAtIso || Date.parse(p.loaded_at) > Date.parse(agg.lastScanAtIso)) {
        agg.lastScanAtIso = p.loaded_at;
      }
    }
    out.set(routeId, agg);
  }

  return out;
}

export interface CrewAgg {
  userId: string;
  /** The route this person was most recently scanning on — a crew member
   *  can move between routes across a shift; only their latest matters for
   *  "which andén are they at right now". */
  routeId: string;
  scanCount: number;
  lastScanAtIso: string;
}

/**
 * One row per distinct `packages.loaded_by` — the "Cuadrillas activas"
 * panel's data. `loaded_by` is nullable (spec-74: absent on a backfilled/
 * inferred row) and a package with no actor contributes nothing here — an
 * inferred historical row is not a crew member currently on the dock.
 */
export function aggregateCrew(
  dispatches: readonly DispatchLinkRow[],
  packages: readonly PackageLoadRow[],
): CrewAgg[] {
  const byOrder = routeIdByOrder(dispatches);
  const byUser = new Map<string, CrewAgg>();

  for (const p of packages) {
    if (!p.loaded_at || !p.loaded_by) continue;
    const routeId = byOrder.get(p.order_id);
    if (!routeId) continue;

    const existing = byUser.get(p.loaded_by);
    if (!existing) {
      byUser.set(p.loaded_by, { userId: p.loaded_by, routeId, scanCount: 1, lastScanAtIso: p.loaded_at });
      continue;
    }
    existing.scanCount += 1;
    if (Date.parse(p.loaded_at) > Date.parse(existing.lastScanAtIso)) {
      existing.lastScanAtIso = p.loaded_at;
      existing.routeId = routeId;
    }
  }

  return [...byUser.values()];
}
