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
 * "EN EL ANDÉN". spec-76 review I4 originally gated this on the wider
 * `DISPATCHABLE_STATUSES` (useRoutePackages.ts / crew-board.ts's
 * `aggregateBoxesByRoute` counting rule), which back then still included
 * `en_bodega` — counting it here had the crew scanning toward a number
 * some of which had never reached the dock. Task 3's escalated decision
 * removed `en_bodega` from `DISPATCHABLE_STATUSES` at the source (it is
 * now rejected at the scanner, not merely excluded from a dock count), so
 * `ON_ANDEN_STATUSES` (anden-status.ts) is now an alias of
 * `DISPATCHABLE_STATUSES` rather than a genuinely narrower set — kept as
 * its own name here because "which boxes count as on the andén" is a
 * distinct question from "which boxes the scanner accepts" even though
 * they resolve to the same set today.
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

/**
 * spec-76 phase 4 (2e/2f) — order_id -> 1-based stop index, for the "parada
 * 09" the scan loop names on the just-scanned package. There is no stored
 * stop-sequence column anywhere in this schema (`assignments.sequence_number`
 * is the OR-Tools optimizer's own table, unrelated to `routes`/`dispatches`
 * — verified against the migrations, not assumed). Rather than invent a
 * second, incompatible notion of "stop", this reuses the exact grouping
 * `countStops` above already uses and 2c already ships as "N paradas":
 * distinct delivery addresses, ordered alphabetically for a deterministic
 * number. It is a stable index into that grouping, not a claim about the
 * driver's actual visiting order — see the "no proxy under a label
 * asserting a fact" rule in Lecciones aplicadas.
 */
export function stopIndexByOrder(
  dispatches: readonly BriefDispatchRow[],
): Map<string, number> {
  const addresses = [
    ...new Set(dispatches.map((d) => d.contact_address?.trim()).filter((a): a is string => !!a)),
  ].sort((a, b) => a.localeCompare(b));
  const indexByAddress = new Map(addresses.map((a, i) => [a, i + 1]));

  const out = new Map<string, number>();
  for (const d of dispatches) {
    const address = d.contact_address?.trim();
    if (!address) continue;
    const idx = indexByAddress.get(address);
    if (idx !== undefined) out.set(d.order_id, idx);
  }
  return out;
}
