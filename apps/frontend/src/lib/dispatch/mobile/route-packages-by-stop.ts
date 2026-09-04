// apps/frontend/src/lib/dispatch/mobile/route-packages-by-stop.ts
//
// spec-76 task 4 (2h) — pure row-shaping for "Paquetes en la ruta":
// packages on the route grouped by stop (or by hour), with the
// "Incompletas" filter. Fetching lives in
// hooks/dispatch/mobile/useRoutePackagesByStop.ts.
//
// Stop grouping deliberately reuses `stopIndexByOrder` (route-load-brief.ts)
// — the SAME "distinct delivery addresses, alphabetical" definition 2c and
// 2e/2f already ship, not a second one. See that function's own doc
// comment: there is no stored stop-sequence column anywhere in this
// schema, and inventing a second incompatible notion of "stop" here would
// make 2e/2f and 2h disagree about which stop a package is on.
//
// "Incompletas" reuses `findIncompleteOrders` (same file) rather than
// re-deriving "has a retenido sibling" — one definition of an incomplete
// order, shared by 2c's pre-scan warning and 2h's filter.
import { stopIndexByOrder, findIncompleteOrders, type BriefDispatchRow, type IncompleteOrder } from './route-load-brief';
import { TIMEZONE } from '@/lib/utils/dateFormat';

export interface StopPackageRow {
  packageId: string;
  dispatchId: string;
  orderId: string;
  orderNumber: string;
  /** Barcode / label — `packages.label`, what gets scanned. */
  barcode: string;
  /** `packages.package_number` — free-form text from the manifest ("2/3",
   *  "2 de 3"...). Often null for a single-box order (declared_box_count
   *  defaults to 1); rendered as-is, never reformatted, and omitted when
   *  absent rather than fabricated. */
  packageNumber: string | null;
  clientName: string | null;
  loaded: boolean;
  loadedAtIso: string | null;
  /** Held in consolidation (`packages.status === 'retenido'`) — spec-76
   *  decision 5's fourth rejection reason, from the other side: this is
   *  the sibling that never made it to the andén. Shown on its stop as
   *  NO EMBARCADO rather than silently absent. */
  notEmbarked: boolean;
}

export interface StopGroup {
  stopIndex: number;
  address: string;
  /** Loaded packages at this stop — the same "cargado" unit the 148 in the
   *  header counts, not a raw row count (a NO EMBARCADO row can inflate
   *  `packages.length` above this without having reached the truck). */
  packageCount: number;
  packages: StopPackageRow[];
}

export interface HourGroup {
  /** "10:00" (start of the hour, America/Santiago) — or `null` for the
   *  trailing bucket of packages with no `loaded_at` (the NO EMBARCADO
   *  ones; they were never loaded, so they have no hour to belong to). */
  hourLabel: string | null;
  packages: StopPackageRow[];
}

export interface RawPackageRow {
  id: string;
  order_id: string;
  label: string;
  package_number: string | null;
  status: string;
  loaded_at: string | null;
}

export interface RawDispatchRow extends BriefDispatchRow {
  dispatch_id: string;
  client_name: string | null;
}

function toStopPackageRow(
  p: RawPackageRow,
  dispatchByOrder: ReadonlyMap<string, RawDispatchRow>,
): StopPackageRow | null {
  const dispatch = dispatchByOrder.get(p.order_id);
  if (!dispatch) return null;
  return {
    packageId: p.id,
    dispatchId: dispatch.dispatch_id,
    orderId: p.order_id,
    orderNumber: dispatch.order_number,
    barcode: p.label,
    packageNumber: p.package_number,
    clientName: dispatch.client_name,
    loaded: !!p.loaded_at,
    loadedAtIso: p.loaded_at,
    notEmbarked: p.status === 'retenido',
  };
}

/**
 * Groups packages by stop (decision 8). A package whose order has no
 * address on file — should not happen, mirrors `countStops`'s own guard —
 * is excluded rather than silently dropped into a fake "stop 0".
 */
export function groupPackagesByStop(
  dispatches: readonly RawDispatchRow[],
  packages: readonly RawPackageRow[],
): StopGroup[] {
  const stopIndex = stopIndexByOrder(dispatches);
  const dispatchByOrder = new Map(dispatches.map((d) => [d.order_id, d]));
  const addressByOrder = new Map(dispatches.map((d) => [d.order_id, d.contact_address?.trim() || null]));

  const groups = new Map<number, StopGroup>();
  for (const p of packages) {
    const idx = stopIndex.get(p.order_id);
    const address = addressByOrder.get(p.order_id);
    if (idx === undefined || !address) continue;
    const row = toStopPackageRow(p, dispatchByOrder);
    if (!row) continue;
    let group = groups.get(idx);
    if (!group) {
      group = { stopIndex: idx, address, packageCount: 0, packages: [] };
      groups.set(idx, group);
    }
    group.packages.push(row);
    if (row.loaded) group.packageCount += 1;
  }

  return [...groups.values()].sort((a, b) => a.stopIndex - b.stopIndex);
}

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TIMEZONE,
});

/** "2026-09-03T14:07:00Z" -> "14:00" in America/Santiago. */
function hourBucketLabel(iso: string): string {
  const [hh] = hourFormatter.format(new Date(iso)).split(':');
  return `${hh}:00`;
}

/**
 * Groups LOADED packages by the hour (America/Santiago) they were scanned,
 * ascending. Packages never loaded (NO EMBARCADO) have no hour to belong
 * to — spec-76 Lecciones aplicadas "no proxy under a label asserting a
 * fact" rules out inventing one, so they land in one trailing
 * `hourLabel: null` bucket instead of being silently dropped from this
 * view.
 */
export function groupPackagesByHour(
  dispatches: readonly RawDispatchRow[],
  packages: readonly RawPackageRow[],
): HourGroup[] {
  const dispatchByOrder = new Map(dispatches.map((d) => [d.order_id, d]));
  const buckets = new Map<string, StopPackageRow[]>();
  const unloaded: StopPackageRow[] = [];

  for (const p of packages) {
    const row = toStopPackageRow(p, dispatchByOrder);
    if (!row) continue;
    if (!row.loadedAtIso) {
      unloaded.push(row);
      continue;
    }
    const label = hourBucketLabel(row.loadedAtIso);
    const bucket = buckets.get(label) ?? [];
    bucket.push(row);
    buckets.set(label, bucket);
  }

  const out: HourGroup[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hourLabel, pkgs]) => ({ hourLabel, packages: pkgs }));
  if (unloaded.length > 0) out.push({ hourLabel: null, packages: unloaded });
  return out;
}

export interface IncompleteFilterState {
  incompleteOrders: IncompleteOrder[];
  incompleteOrderIds: ReadonlySet<string>;
}

/** Orders with a retenido sibling — reused from route-load-brief.ts (see
 *  file header). `packagesByOrder` groups the SAME `packages` rows this
 *  module fetches, keyed by order_id, using route-load-brief's own
 *  `BriefPackageRow` shape (status + order_id is all it reads). */
export function findIncompleteFilterState(
  dispatches: readonly RawDispatchRow[],
  packagesByOrder: ReadonlyMap<string, readonly { order_id: string; status: string; loaded_at: string | null }[]>,
): IncompleteFilterState {
  const incompleteOrders = findIncompleteOrders(dispatches, packagesByOrder);
  return { incompleteOrders, incompleteOrderIds: new Set(incompleteOrders.map((o) => o.orderId)) };
}

/** Applies the "Incompletas" filter: keeps only packages whose order is
 *  incomplete, drops any stop/hour bucket left with nothing, and
 *  recomputes `packageCount` on what remains. */
export function filterStopGroupsToIncomplete(
  groups: readonly StopGroup[],
  incompleteOrderIds: ReadonlySet<string>,
): StopGroup[] {
  const out: StopGroup[] = [];
  for (const g of groups) {
    const packages = g.packages.filter((p) => incompleteOrderIds.has(p.orderId));
    if (packages.length === 0) continue;
    out.push({
      ...g,
      packages,
      packageCount: packages.filter((p) => p.loaded).length,
    });
  }
  return out;
}

export function filterHourGroupsToIncomplete(
  groups: readonly HourGroup[],
  incompleteOrderIds: ReadonlySet<string>,
): HourGroup[] {
  const out: HourGroup[] = [];
  for (const g of groups) {
    const packages = g.packages.filter((p) => incompleteOrderIds.has(p.orderId));
    if (packages.length === 0) continue;
    out.push({ ...g, packages });
  }
  return out;
}
