import type { PreRouteAnden, PreRouteOrder } from '@/lib/types';

/**
 * spec-54 phase 4.2 — grouping and selection for the unrouted-orders column.
 *
 * The mock offers three groupings: por comuna, por cliente, por SLA. Only two
 * are buildable from get_pre_route_snapshot, which returns andenes with their
 * comunas and counts — it carries no client and no SLA per group. So the chips
 * here are **Por andén** and **Por comuna**, and the missing two wait for the
 * snapshot RPC to return that data rather than being rendered as dead options.
 *
 * Each group also carries its flattened order rows (`UnroutedGroup.orders`),
 * because operations needs to see and act on individual orders, not just
 * groups. Selection lives at the order level — a group checkbox is a derived
 * shortcut (`groupSelectionState` / `toggleGroupSelection`), not a
 * selectable unit of its own. `groupCount` on `SelectionSummary` means
 * "groups touched by the current order selection", not "groups explicitly
 * checked" — `RoutePlanCanvas` and `RouteDraftPanel` both read it as a group
 * total, so redefining it here keeps both correct without either needing to
 * know selection moved to the order level.
 */

export type GroupBy = 'anden' | 'comuna';

/** One order, flattened out of the snapshot's andén → comuna → orders nesting. */
export interface UnroutedOrderRow {
  id: string;
  orderNumber: string;
  /** Always the order's OWN comuna — never the group's, which can span several. */
  comunaName: string;
  address: string;
  packageCount: number;
  windowStart: string | null;
  windowEnd: string | null;
  hasSplitDockZone: boolean;
}

export interface UnroutedGroup {
  id: string;
  name: string;
  /** Supporting line — comunas covered, or andenes the comuna spans. */
  subtitle: string;
  orderCount: number;
  packageCount: number;
  orders: UnroutedOrderRow[];
  /** Orders in this group sit across more than one dock zone. */
  warning: boolean;
}

function toOrderRow(order: PreRouteOrder, comunaName: string): UnroutedOrderRow {
  return {
    id: order.id,
    orderNumber: order.order_number,
    comunaName,
    address: order.delivery_address,
    packageCount: order.package_count,
    windowStart: order.delivery_window_start,
    windowEnd: order.delivery_window_end,
    hasSplitDockZone: order.has_split_dock_zone,
  };
}

export function buildGroups(andenes: PreRouteAnden[], groupBy: GroupBy): UnroutedGroup[] {
  if (groupBy === 'anden') {
    return andenes.map((a) => ({
      id: a.id,
      name: a.name,
      subtitle: a.comunas_list.join(' · '),
      orderCount: a.order_count,
      packageCount: a.package_count,
      orders: a.comunas.flatMap((c) => c.orders.map((o) => toOrderRow(o, c.name))),
      warning: a.has_split_dock_zone_warnings,
    }));
  }

  // A comuna can appear under more than one andén — that split is precisely
  // what has_split_dock_zone_warnings flags — so counts accumulate and the
  // andén names are collected rather than the last one winning. Orders come
  // straight from each comuna's own `orders` list (not the andén's), which
  // keeps a merged group's order rows scoped to that comuna specifically.
  const byComuna = new Map<string, UnroutedGroup & { andenNames: string[] }>();

  for (const anden of andenes) {
    for (const comuna of anden.comunas) {
      const rows = comuna.orders.map((o) => toOrderRow(o, comuna.name));
      const existing = byComuna.get(comuna.id);
      if (existing) {
        existing.orderCount += comuna.order_count;
        existing.packageCount += comuna.package_count;
        existing.andenNames.push(anden.name);
        existing.orders.push(...rows);
        existing.warning = true;
        continue;
      }
      byComuna.set(comuna.id, {
        id: comuna.id,
        name: comuna.name,
        subtitle: '',
        orderCount: comuna.order_count,
        packageCount: comuna.package_count,
        orders: rows,
        warning: anden.has_split_dock_zone_warnings,
        andenNames: [anden.name],
      });
    }
  }

  return [...byComuna.values()]
    .map(({ andenNames, ...group }) => ({ ...group, subtitle: andenNames.join(' · ') }))
    .sort((a, b) => b.orderCount - a.orderCount);
}

export interface SelectionSummary {
  groupCount: number;
  orderCount: number;
  packageCount: number;
  comunaCount: number;
  orderIds: string[];
}

/** Totals for the orders currently ticked, for the footer, draft panel and plan canvas. */
export function summariseOrderSelection(
  groups: UnroutedGroup[],
  selectedOrderIds: Set<string>,
): SelectionSummary {
  const comunas = new Set<string>();
  const groupsTouched = new Set<string>();
  const orderIds: string[] = [];
  let packageCount = 0;

  for (const group of groups) {
    for (const order of group.orders) {
      if (!selectedOrderIds.has(order.id)) continue;
      orderIds.push(order.id);
      packageCount += order.packageCount;
      comunas.add(order.comunaName);
      groupsTouched.add(group.id);
    }
  }

  return {
    groupCount: groupsTouched.size,
    orderCount: orderIds.length,
    packageCount,
    comunaCount: comunas.size,
    orderIds,
  };
}

/** Whether none, some, or every order in a group is selected — drives the group checkbox's tri-state. */
export function groupSelectionState(
  group: UnroutedGroup,
  selectedOrderIds: Set<string>,
): 'all' | 'some' | 'none' {
  if (group.orders.length === 0) return 'none';
  const selectedCount = group.orders.filter((o) => selectedOrderIds.has(o.id)).length;
  if (selectedCount === 0) return 'none';
  return selectedCount === group.orders.length ? 'all' : 'some';
}

/**
 * The group checkbox's shortcut behaviour: fully selected → clear the group,
 * anything else (none or partial) → select every order in it.
 */
export function toggleGroupSelection(group: UnroutedGroup, selectedOrderIds: Set<string>): Set<string> {
  const state = groupSelectionState(group, selectedOrderIds);
  const next = new Set(selectedOrderIds);
  if (state === 'all') {
    for (const order of group.orders) next.delete(order.id);
  } else {
    for (const order of group.orders) next.add(order.id);
  }
  return next;
}

/** Every order id across every group, for the footer's "select all" bulk action. */
export function allOrderIds(groups: UnroutedGroup[]): string[] {
  return groups.flatMap((g) => g.orders.map((o) => o.id));
}

/**
 * Ascending sort by window start, orders with no window pushed to the end.
 * Used by the "Ordenar por ventana" toggle in UnroutedColumn — sorts each
 * group's rows independently, it never reorders across groups.
 */
export function sortOrdersByWindow(orders: UnroutedOrderRow[]): UnroutedOrderRow[] {
  return [...orders].sort((a, b) => {
    if (a.windowStart === b.windowStart) return 0;
    if (a.windowStart === null) return 1;
    if (b.windowStart === null) return -1;
    return a.windowStart.localeCompare(b.windowStart);
  });
}

/**
 * Order ids whose delivery window closes at the earliest end time among the
 * given rows — the set UnroutedOrderRow renders its urgency chip red for.
 * Computed across every visible row (all groups), not per group, so an
 * order isn't "urgent" only relative to its own comuna/andén. Orders with
 * no windowEnd are never urgent — there's nothing to close "sooner" on.
 */
export function urgentOrderIds(orders: UnroutedOrderRow[]): Set<string> {
  const ends = orders.map((o) => o.windowEnd).filter((e): e is string => e !== null);
  if (ends.length === 0) return new Set();
  const earliest = ends.reduce((min, e) => (e < min ? e : min));
  return new Set(orders.filter((o) => o.windowEnd === earliest).map((o) => o.id));
}
