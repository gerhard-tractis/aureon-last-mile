import type { ZoneGroup, OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-96 Fase 2 — `4d`'s SEL control. Pure helpers for turning a set of
 * selected order ids (spanning any number of zone groups) into the single
 * `SendToDockRequest` the existing `SendToDockSheet` pipeline expects —
 * SEL's action is that same sheet, applied to the selection.
 *
 * `SendToDockRequest` lives here, not in `PendingMobileList.tsx` (which
 * re-exports it for its existing callers) — this module must not import
 * from `components/` (app→components→hooks→lib flows one way).
 */
export interface SendToDockRequest {
  packageIds: string[];
  /** Same order as packageIds — the audit trail's barcode field per package. */
  packageLabels: string[];
  /** BULTO-code for a single package, order number for a whole order. */
  code: string;
  comunaName: string | null;
  suggestedZone: ZoneGroup['zone'];
  /**
   * spec-96 Fase 2 — set when a SEL batch spans more than one suggested
   * zone. `SendToDockSheet.mixedComunaBatch` (spec-68 Fase 4 review,
   * finding #2) already exists for exactly this case; this just plumbs it
   * through for the new caller.
   */
  mixedComunaBatch?: boolean;
}

/** Every order across every group, paired with the zone its group suggests. */
export function flattenOrders(groups: ZoneGroup[]): Array<{ order: OrderGroup; zone: DockZoneRecord }> {
  return groups.flatMap((group) => group.orders.map((order) => ({ order, zone: group.zone })));
}

export function buildSelectionRequest(
  groups: ZoneGroup[],
  selectedOrderIds: Set<string>,
): SendToDockRequest | null {
  const selected = flattenOrders(groups).filter(({ order }) => selectedOrderIds.has(order.orderId));
  if (selected.length === 0) return null;

  const packageIds = selected.flatMap(({ order }) => order.packages.map((p) => p.id));
  const packageLabels = selected.flatMap(({ order }) => order.packages.map((p) => p.label));
  const distinctComunas = new Set(selected.map(({ order }) => order.comunaName));
  const distinctZoneIds = new Set(selected.map(({ zone }) => zone.id));

  return {
    packageIds,
    packageLabels,
    code: selected.length === 1 ? selected[0].order.orderNumber : `${selected.length} pedidos`,
    comunaName: distinctComunas.size === 1 ? selected[0].order.comunaName : null,
    suggestedZone: selected[0].zone,
    mixedComunaBatch: distinctZoneIds.size > 1,
  };
}
