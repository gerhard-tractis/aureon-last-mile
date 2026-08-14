import type { PreRouteAnden } from '@/lib/types';

/**
 * spec-54 phase 4.2 — grouping for the unrouted-orders column (mock 1c).
 *
 * The mock offers three groupings: por comuna, por cliente, por SLA. Only two
 * are buildable from get_pre_route_snapshot, which returns andenes with their
 * comunas and counts — it carries no client and no SLA per group. So the chips
 * here are **Por andén** and **Por comuna**, and the missing two wait for the
 * snapshot RPC to return that data rather than being rendered as dead options.
 */

export type GroupBy = 'anden' | 'comuna';

export interface UnroutedGroup {
  id: string;
  name: string;
  /** Supporting line — comunas covered, or andenes the comuna spans. */
  subtitle: string;
  orderCount: number;
  packageCount: number;
  orderIds: string[];
  /** Orders in this group sit across more than one dock zone. */
  warning: boolean;
}

export function buildGroups(andenes: PreRouteAnden[], groupBy: GroupBy): UnroutedGroup[] {
  if (groupBy === 'anden') {
    return andenes.map((a) => ({
      id: a.id,
      name: a.name,
      subtitle: a.comunas_list.join(' · '),
      orderCount: a.order_count,
      packageCount: a.package_count,
      orderIds: a.order_ids,
      warning: a.has_split_dock_zone_warnings,
    }));
  }

  // A comuna can appear under more than one andén — that split is precisely
  // what has_split_dock_zone_warnings flags — so counts accumulate and the
  // andén names are collected rather than the last one winning.
  const byComuna = new Map<string, UnroutedGroup & { andenNames: string[] }>();

  for (const anden of andenes) {
    for (const comuna of anden.comunas) {
      const existing = byComuna.get(comuna.id);
      if (existing) {
        existing.orderCount += comuna.order_count;
        existing.packageCount += comuna.package_count;
        existing.andenNames.push(anden.name);
        existing.orderIds.push(...anden.order_ids);
        existing.warning = true;
        continue;
      }
      byComuna.set(comuna.id, {
        id: comuna.id,
        name: comuna.name,
        subtitle: '',
        orderCount: comuna.order_count,
        packageCount: comuna.package_count,
        orderIds: [...anden.order_ids],
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

/** Totals for the groups currently ticked, for the footer and draft panel. */
export function summariseSelection(
  groups: UnroutedGroup[],
  selectedIds: Set<string>,
): SelectionSummary {
  const selected = groups.filter((g) => selectedIds.has(g.id));

  const comunas = new Set<string>();
  const orderIds = new Set<string>();
  let orderCount = 0;
  let packageCount = 0;

  for (const group of selected) {
    orderCount += group.orderCount;
    packageCount += group.packageCount;
    for (const id of group.orderIds) orderIds.add(id);
    // Under "por andén" the subtitle lists comunas; under "por comuna" the
    // group itself is one.
    for (const name of group.subtitle ? group.subtitle.split(' · ') : [group.name]) {
      comunas.add(name);
    }
  }

  return {
    groupCount: selected.length,
    orderCount,
    packageCount,
    comunaCount: selected.length === 0 ? 0 : comunas.size,
    orderIds: [...orderIds],
  };
}
