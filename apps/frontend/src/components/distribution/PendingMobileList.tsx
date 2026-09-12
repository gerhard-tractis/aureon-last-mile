'use client';

import { Card, CardContent } from '@/components/ui/card';
import { PendingZoneSection } from './PendingZoneSection';
import { determineDockZone } from '@/lib/distribution/sectorization-engine';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import type { SendToDockRequest } from '@/lib/distribution/pending-selection';
import type { ZoneGroup, OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 3 — `4d`, pendientes de sectorizar, below `lg`.
 *
 * Grouped by the andén the engine computed (`usePendingSectorization`
 * already returns this shape — no new query). Within a group, an order
 * renders under SIN ANDÉN (warning palette) instead of a normal header
 * when it is genuinely unmapped (unknown comuna) — see `isOrderFlagged`
 * below for why that can't just be read off `group.matchResult.flagged`.
 *
 * Row expansion lives in `PendingMobileOrderGroup`: in `'det'` mode (the
 * default) a single-bulto order is one compact row and a multi-bulto order
 * is an order line plus one row per package; `'cmp'` forces every order
 * into one compact row (spec-96 Fase 2, `4d`'s DET/CMP control).
 *
 * `selectionMode`/`selectedOrderIds`/`onToggleOrderSelection` (spec-96
 * Fase 2, `4d`'s SEL control) are fully controlled by the page — this
 * component owns no selection state of its own. Review fix: the confirm
 * action (counter + "Enviar seleccionados") does NOT live in here either.
 * It first shipped as a `sticky bottom-0` bar with no `z-index`, painted
 * over by the page's own `fixed z-40` footer at every scroll position
 * where the list overflows (the window is the scroll container —
 * `AppLayout`'s `<main>` has no `overflow-y-auto`) — the identical shape
 * to the Fase 3 regression this spec already records. The page renders
 * that confirm action in its own fixed footer instead, following `4f`'s
 * shape (counter eyebrow, then the primary action, both inside the
 * `flex:none` footer) and the review's `FOOTER_METRICS` pattern.
 */
export type { SendToDockRequest };

export interface PendingMobileListProps {
  groups: ZoneGroup[];
  /**
   * All dock zones (active and inactive alike — the same list
   * `usePendingSectorization` itself reads off `useDockZones`), needed to
   * recompute each order's own flagged status. Not a new query: this is
   * the same zones array the page already has, passed straight through.
   */
  zones: DockZoneRecord[];
  /** Gates every ⋯ affordance — mirrors useManualDockAssignment.canUse. */
  canManualAssign: boolean;
  onRequestSend: (request: SendToDockRequest) => void;
  /** Injectable for tests; defaults to now. */
  now?: Date;
  /** spec-96 Fase 2 — `4d`'s DET/CMP control. Defaults to `'det'`. */
  mode?: 'det' | 'cmp';
  /** spec-96 Fase 2 — `4d`'s SEL control. Fully controlled by the page. */
  selectionMode?: boolean;
  selectedOrderIds?: Set<string>;
  onToggleOrderSelection?: (orderId: string) => void;
}

/**
 * spec-68 Fase 3 review (finding #5) — `usePendingSectorization` stores
 * `matchResult` ONCE PER ZONE BUCKET, taken from whichever order landed
 * there first. The consolidation bucket legitimately mixes three cases —
 * a future-dated retention (flagged:false), an order with a genuinely
 * unmapped comuna (flagged:true), and an order with no comuna at all
 * (flagged:false) — all sharing `zone_id = consolidación`. Trusting the
 * bucket-level flag would make the SIN ANDÉN label depend on which order
 * happened to be fetched first, mislabeling either real retentions as SIN
 * ANDÉN or genuinely-unmapped orders as a plain "ANDÉN CONS" section.
 *
 * This recomputes `determineDockZone` per order — the same pure function
 * the hook already calls, over data already fetched — rather than trusting
 * the group-level flag. Falls back to the group's own flag if `zones` is
 * momentarily missing its consolidation zone (still loading) rather than
 * throwing.
 */
function isOrderFlagged(order: OrderGroup, zones: DockZoneRecord[], today: string, fallback: boolean): boolean {
  const rep = order.packages[0];
  if (!rep || !zones.some((z) => z.is_consolidation)) return fallback;
  try {
    return determineDockZone({ comunaId: rep.comunaId, delivery_date: rep.delivery_date }, zones, today).flagged;
  } catch {
    return fallback;
  }
}

const EMPTY_SELECTION = new Set<string>();
function noop() {}

export function PendingMobileList({
  groups,
  zones,
  canManualAssign,
  onRequestSend,
  now,
  mode = 'det',
  selectionMode = false,
  selectedOrderIds = EMPTY_SELECTION,
  onToggleOrderSelection = noop,
}: PendingMobileListProps) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-text-secondary">
          No hay paquetes pendientes en este momento.
        </CardContent>
      </Card>
    );
  }

  const today = todayISOInTimezone(now);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const flaggedOrders: OrderGroup[] = [];
        const normalOrders: OrderGroup[] = [];
        for (const order of group.orders) {
          const flagged = isOrderFlagged(order, zones, today, group.matchResult.flagged);
          (flagged ? flaggedOrders : normalOrders).push(order);
        }

        return (
          <div key={group.zone.id} className="flex flex-col gap-5">
            {flaggedOrders.length > 0 && (
              <PendingZoneSection
                testId={`pending-group-${group.zone.id}-sin-anden`}
                zone={group.zone}
                orders={flaggedOrders}
                isFlagged
                canManualAssign={canManualAssign}
                onRequestSend={onRequestSend}
                mode={mode}
                selectionMode={selectionMode}
                selectedOrderIds={selectedOrderIds}
                onToggleOrderSelection={onToggleOrderSelection}
              />
            )}
            {normalOrders.length > 0 && (
              <PendingZoneSection
                testId={`pending-group-${group.zone.id}`}
                zone={group.zone}
                orders={normalOrders}
                isFlagged={false}
                canManualAssign={canManualAssign}
                onRequestSend={onRequestSend}
                mode={mode}
                selectionMode={selectionMode}
                selectedOrderIds={selectedOrderIds}
                onToggleOrderSelection={onToggleOrderSelection}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
