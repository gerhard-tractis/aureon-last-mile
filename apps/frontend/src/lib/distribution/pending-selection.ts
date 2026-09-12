import type { ZoneGroup, OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { matchZoneByComuna } from '@/lib/distribution/consolidation-zone-match';

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

/** Every order across every group, paired with the zone its group's bucket landed in. */
export function flattenOrders(groups: ZoneGroup[]): Array<{ order: OrderGroup; zone: DockZoneRecord }> {
  return groups.flatMap((group) => group.orders.map((order) => ({ order, zone: group.zone })));
}

/**
 * Round-2 review fix — the bucket zone (`flattenOrders`'s `zone`) comes
 * from `determineDockZone`, which is DATE-aware: a future-dated order
 * whose comuna matches a real andén still lands in the consolidación
 * bucket. Filtering the bucket zone on `!is_consolidation` (round 1's
 * fix) therefore silently dropped that order from the mixed-batch check
 * AND from the suggested-zone search — a batch of "La Florida, ships next
 * week" + "Maipú, ships today" read as a clean single-zone match on A6,
 * badged SUGERIDO, for a selection that actually disagrees.
 *
 * `ConsolidationPageContent.isMixedComunaBatch`/`resolveSuggestedZone`
 * (spec-68 Fase 4 review, finding #1 and #2) solve the identical problem
 * with a comuna-only match (`matchZoneByComuna`), independent of WHY a
 * package is sitting in consolidación. Reused here rather than
 * re-derived, so the two callers cannot drift on what "mixed" means a
 * second time.
 */
function matchedZonesFor(selected: OrderGroup[], zones: DockZoneRecord[]): DockZoneRecord[] {
  return selected
    .map((order) => matchZoneByComuna(order.packages[0]?.comunaId ?? null, zones))
    .filter((zone): zone is DockZoneRecord => zone !== null);
}

function isMixedComunaBatch(selected: OrderGroup[], zones: DockZoneRecord[]): boolean {
  const matchedZoneIds = new Set(matchedZonesFor(selected, zones).map((zone) => zone.id));
  return matchedZoneIds.size > 1;
}

/**
 * The zone the sheet pre-selects, badged SUGERIDO: the first selected
 * order's own comuna match, falling back to consolidación only when
 * NOTHING in the batch matches a real andén — mirrors
 * `ConsolidationPageContent.resolveSuggestedZone` exactly, including its
 * finding #1 (never fall back to an arbitrary active andén).
 */
function resolveSuggestedZone(
  selected: Array<{ order: OrderGroup; zone: DockZoneRecord }>,
  zones: DockZoneRecord[],
): DockZoneRecord {
  for (const { order } of selected) {
    const matched = matchZoneByComuna(order.packages[0]?.comunaId ?? null, zones);
    if (matched) return matched;
  }
  return zones.find((z) => z.is_consolidation) ?? selected[0].zone;
}

export function buildSelectionRequest(
  groups: ZoneGroup[],
  selectedOrderIds: Set<string>,
  zones: DockZoneRecord[],
): SendToDockRequest | null {
  const selected = flattenOrders(groups).filter(({ order }) => selectedOrderIds.has(order.orderId));
  if (selected.length === 0) return null;

  const packageIds = selected.flatMap(({ order }) => order.packages.map((p) => p.id));
  const packageLabels = selected.flatMap(({ order }) => order.packages.map((p) => p.label));
  const distinctComunas = new Set(selected.map(({ order }) => order.comunaName));

  return {
    packageIds,
    packageLabels,
    code: selected.length === 1 ? selected[0].order.orderNumber : `${selected.length} pedidos`,
    comunaName: distinctComunas.size === 1 ? selected[0].order.comunaName : null,
    suggestedZone: resolveSuggestedZone(selected, zones),
    mixedComunaBatch: isMixedComunaBatch(
      selected.map(({ order }) => order),
      zones,
    ),
  };
}
