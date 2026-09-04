// apps/frontend/src/lib/dispatch/route-tracking.ts
//
// spec-75 phase 4 — pure derivation for the `1c` read-only route tracking
// view (a manager watching a crew scan on mobile, live). Mirrors
// loading-monitor-aggregate.ts's dispatches -> packages two-hop shape
// (packages has no direct FK to dispatches, both point at orders) but
// scoped to ONE route and enriched with the per-order fields 1c's mock
// needs (comuna, address, client name) that the aggregate monitor never
// selected. No Supabase, no React — testable without mocking a client, and
// reused by useRouteTrackingBrief.ts.

import { DISPATCHABLE_STATUSES } from './scan-validator';
import { stopIndexByOrder, type BriefDispatchRow } from './mobile/route-load-brief';

export interface TrackingDispatchRow {
  order_id: string;
  order_number: string;
  comuna: string | null;
  address: string | null;
  customerName: string | null;
}

export interface TrackingPackageRow {
  id: string;
  order_id: string;
  label: string;
  loaded_at: string | null;
  loaded_by: string | null;
  /**
   * Phase-4 review CRITICAL — every other consumer of this exact
   * dispatches->packages two-hop (`useRoutePackages.ts`,
   * `route-load-brief.ts`, `seal-route.ts`) filters a package out entirely
   * once it is neither loaded nor still `DISPATCHABLE_STATUSES` (a
   * `retenido`/`dañado`/etc. box "cannot become loaded, so counting it
   * would ... make the row unable to ever reach 'N of N'" —
   * `useRoutePackages.ts`'s own comment). This hook used to select
   * `loaded_at`/`loaded_by` only and never apply that predicate, so an
   * order with one such box could never leave `1c`'s pending list —
   * permanently "N sin escanear" on a route the crew's phone and `/seal`
   * both already treat as complete. `status` is what lets
   * `buildRouteTrackingSummary` apply the same rule.
   */
  status: string;
}

export interface ScanEntry {
  packageId: string;
  label: string;
  orderNumber: string;
  comuna: string | null;
  address: string | null;
  customerName: string | null;
  loadedAtIso: string;
  loadedBy: string | null;
  /**
   * 1-based stop index — "PARADA 09". Phase-4 review — this used to rank
   * orders by dock-arrival order (earliest `loaded_at`), which sounded
   * honest but disagreed with the number the SAME box already carries on
   * the crew's phone: `mobile/route-load-brief.ts`'s `stopIndexByOrder`
   * (shipped in spec-76, rendered as "parada NN" in
   * `DispatchPackagesByStop`/`DispatchScanLastRead`) indexes by distinct
   * delivery address, sorted alphabetically — deliberately NOT a claim
   * about visiting order, reusing the exact grouping `countStops`/2c's "N
   * paradas" already use. Two live surfaces (crew phone, manager desktop)
   * disagreeing on a number they say out loud to each other is worse than
   * either being a proxy, so this reuses that function rather than
   * inventing a second, incompatible notion of "stop".
   */
  stopNumber: number;
  /** 1-based index of this package among its order's own LOADED packages,
   *  ordered by `loaded_at` — "paquete 2 de 3". */
  boxIndexInOrder: number;
  /** Count of this order's live, in-scope packages (loaded + still on the
   *  dock) — the "de 3" in "paquete 2 de 3". */
  boxesTotalInOrder: number;
}

export interface PendingOrder {
  orderId: string;
  orderNumber: string;
  comuna: string | null;
}

export interface RouteTrackingSummary {
  /** Newest first — the scan list's own order. */
  scans: ScanEntry[];
  packagesLoadedCount: number;
  packagesExpectedCount: number;
  packagesUnscannedCount: number;
  pendingOrders: PendingOrder[];
}

/** Same rule `useRoutePackages.ts` applies (its own comment explains why):
 *  a package is in scope once it is either already loaded, or still
 *  eligible to be (`DISPATCHABLE_STATUSES`). Anything else — `retenido`,
 *  `dañado`, `entregado`, never loaded — cannot become loaded, so it is
 *  excluded before it ever reaches a count or the pending list. */
function isInScope(p: TrackingPackageRow): boolean {
  return !!p.loaded_at || (DISPATCHABLE_STATUSES as readonly string[]).includes(p.status);
}

export function buildRouteTrackingSummary(
  dispatches: readonly TrackingDispatchRow[],
  packages: readonly TrackingPackageRow[],
): RouteTrackingSummary {
  const dispatchByOrder = new Map(dispatches.map((d) => [d.order_id, d]));

  const packagesByOrder = new Map<string, TrackingPackageRow[]>();
  for (const p of packages) {
    if (!dispatchByOrder.has(p.order_id) || !isInScope(p)) continue;
    const list = packagesByOrder.get(p.order_id) ?? [];
    list.push(p);
    packagesByOrder.set(p.order_id, list);
  }

  const briefDispatches: BriefDispatchRow[] = dispatches.map((d) => ({
    order_id: d.order_id,
    order_number: d.order_number,
    contact_address: d.address,
  }));
  const stopNumberByOrder = stopIndexByOrder(briefDispatches);

  const scans: ScanEntry[] = [];
  for (const [orderId, orderPackages] of packagesByOrder) {
    const dispatch = dispatchByOrder.get(orderId)!;
    const loaded = orderPackages
      .filter((p): p is TrackingPackageRow & { loaded_at: string } => !!p.loaded_at)
      .sort((a, b) => Date.parse(a.loaded_at) - Date.parse(b.loaded_at));
    loaded.forEach((p, i) => {
      scans.push({
        packageId: p.id,
        label: p.label,
        orderNumber: dispatch.order_number,
        comuna: dispatch.comuna,
        address: dispatch.address,
        customerName: dispatch.customerName,
        loadedAtIso: p.loaded_at,
        loadedBy: p.loaded_by,
        stopNumber: stopNumberByOrder.get(orderId) ?? 0,
        boxIndexInOrder: i + 1,
        boxesTotalInOrder: orderPackages.length,
      });
    });
  }
  scans.sort((a, b) => Date.parse(b.loadedAtIso) - Date.parse(a.loadedAtIso));

  const packagesExpectedCount = [...packagesByOrder.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );
  const packagesLoadedCount = scans.length;

  const pendingOrders: PendingOrder[] = dispatches
    .filter((d) => (packagesByOrder.get(d.order_id) ?? []).some((p) => !p.loaded_at))
    .map((d) => ({ orderId: d.order_id, orderNumber: d.order_number, comuna: d.comuna }));

  return {
    scans,
    packagesLoadedCount,
    packagesExpectedCount,
    packagesUnscannedCount: Math.max(0, packagesExpectedCount - packagesLoadedCount),
    pendingOrders,
  };
}
