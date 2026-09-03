// apps/frontend/src/lib/dispatch/mobile/route-load-brief.ts
//
// spec-76 phase 3 — pure row-shaping for 2c ("Antes de escanear"): what is
// on the dock for one route before the crew starts scanning. Fetching lives
// in hooks/dispatch/mobile/useRouteLoadBrief.ts.

import { ON_ANDEN_STATUSES } from './anden-status';

export interface BriefDispatchRow {
  order_id: string;
  order_number: string;
  contact_address: string | null;
}

export interface BriefPackageRow {
  order_id: string;
  status: string;
  loaded_at: string | null;
}

export interface ComunaCount { comuna: string; count: number }

export function comunaBreakdown(
  dispatches: readonly BriefDispatchRow[],
  comunaByOrder: ReadonlyMap<string, string | null>,
): ComunaCount[] {
  const counts = new Map<string, number>();
  for (const d of dispatches) {
    const comuna = comunaByOrder.get(d.order_id);
    if (!comuna) continue;
    counts.set(comuna, (counts.get(comuna) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([comuna, count]) => ({ comuna, count }))
    .sort((a, b) => b.count - a.count || a.comuna.localeCompare(b.comuna));
}

/** Distinct delivery addresses on the route — the "paradas" count. An order
 *  with no address on file (should not happen, but a query failure upstream
 *  must not crash this count) is excluded rather than counted as its own
 *  stop. */
export function countStops(dispatches: readonly BriefDispatchRow[]): number {
  const addresses = new Set(
    dispatches.map((d) => d.contact_address?.trim()).filter((a): a is string => !!a),
  );
  return addresses.size;
}

/**
 * Boxes actually sitting on the dock for this route, not yet loaded —
 * "EN EL ANDÉN". spec-76 review I4: this used to gate on the wider
 * `DISPATCHABLE_STATUSES` (useRoutePackages.ts / crew-board.ts's
 * `aggregateBoxesByRoute` counting rule), which includes `en_bodega` — the
 * exact status decision 5's own rejection reason names as "no pasó por
 * andén". Counting it here had the crew scanning toward a number some of
 * which had never reached the dock. `ON_ANDEN_STATUSES` is the narrower
 * set that actually means "physically on the andén, ready to load".
 */
export function countPendingOnDock(packages: readonly BriefPackageRow[]): number {
  let pending = 0;
  for (const p of packages) {
    if (p.loaded_at) continue;
    if ((ON_ANDEN_STATUSES as readonly string[]).includes(p.status)) pending += 1;
  }
  return pending;
}

export interface IncompleteOrder { orderId: string; orderNumber: string }

/**
 * Orders on this route with a sibling package `retenido` (held in
 * consolidation) — spec-76 decision 5's fourth rejection reason, surfaced
 * here as the pre-scan warning ("Les falta un paquete que está en
 * consolidación..."). An order counts once even if more than one sibling is
 * retenido.
 */
export function findIncompleteOrders(
  dispatches: readonly BriefDispatchRow[],
  packagesByOrder: ReadonlyMap<string, readonly BriefPackageRow[]>,
): IncompleteOrder[] {
  const out: IncompleteOrder[] = [];
  const seen = new Set<string>();
  for (const d of dispatches) {
    if (seen.has(d.order_id)) continue;
    const pkgs = packagesByOrder.get(d.order_id) ?? [];
    const hasRetained = pkgs.some((p) => p.status === 'retenido');
    if (hasRetained) {
      seen.add(d.order_id);
      out.push({ orderId: d.order_id, orderNumber: d.order_number });
    }
  }
  return out;
}

export function groupPackagesByOrder(
  packages: readonly BriefPackageRow[],
): Map<string, BriefPackageRow[]> {
  const out = new Map<string, BriefPackageRow[]>();
  for (const p of packages) {
    const list = out.get(p.order_id) ?? [];
    list.push(p);
    out.set(p.order_id, list);
  }
  return out;
}
