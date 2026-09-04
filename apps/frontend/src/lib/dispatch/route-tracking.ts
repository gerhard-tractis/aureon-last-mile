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
   * 1-based dock arrival order — the Nth distinct stop (order) to have had
   * a package loaded, ranked by that order's EARLIEST `loaded_at`.
   *
   * This is deliberately NOT `dispatches.planned_sequence` or
   * `actual_sequence` (spec-72): neither is populated while a route is
   * still `loading` — `compute_route_actual_sequence` only runs on the
   * `completed` transition (spec-72 phase 5 migration), long after this
   * screen matters. This is an honest "what has arrived on the dock so
   * far, in the order it arrived" count, not a claim about the route's
   * planned delivery sequence — see spec-76 Lecciones aplicadas #1
   * ("a proxy is not shown under a label asserting a fact").
   */
  stopNumber: number;
  /** 1-based index of this package among its order's own LOADED packages,
   *  ordered by `loaded_at` — "paquete 2 de 3". */
  boxIndexInOrder: number;
  /** Count of this order's live packages (loaded + still on the dock),
   *  the "de 3" in "paquete 2 de 3". */
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

export function buildRouteTrackingSummary(
  dispatches: readonly TrackingDispatchRow[],
  packages: readonly TrackingPackageRow[],
): RouteTrackingSummary {
  const dispatchByOrder = new Map(dispatches.map((d) => [d.order_id, d]));

  const packagesByOrder = new Map<string, TrackingPackageRow[]>();
  for (const p of packages) {
    if (!dispatchByOrder.has(p.order_id)) continue;
    const list = packagesByOrder.get(p.order_id) ?? [];
    list.push(p);
    packagesByOrder.set(p.order_id, list);
  }

  // Earliest loaded_at per order -> that order's dock-arrival rank.
  const firstLoadedAtByOrder = new Map<string, string>();
  for (const p of packages) {
    if (!p.loaded_at || !dispatchByOrder.has(p.order_id)) continue;
    const cur = firstLoadedAtByOrder.get(p.order_id);
    if (!cur || Date.parse(p.loaded_at) < Date.parse(cur)) {
      firstLoadedAtByOrder.set(p.order_id, p.loaded_at);
    }
  }
  const rankedOrderIds = [...firstLoadedAtByOrder.entries()]
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .map(([orderId]) => orderId);
  const stopNumberByOrder = new Map<string, number>(
    rankedOrderIds.map((orderId, i) => [orderId, i + 1]),
  );

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
