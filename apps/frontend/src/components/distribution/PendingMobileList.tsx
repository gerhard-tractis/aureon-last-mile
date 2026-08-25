'use client';

import { Card, CardContent } from '@/components/ui/card';
import { PendingMobileOrderGroup } from './PendingMobileOrderGroup';
import { determineDockZone } from '@/lib/distribution/sectorization-engine';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import type { ZoneGroup, OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 3 — `4d`, pendientes de sectorizar, below `lg`.
 *
 * Grouped by the andén the engine computed (`usePendingSectorization`
 * already returns this shape — no new query). Within a group, an order
 * renders under SIN ANDÉN (warning palette) instead of a normal header
 * when it is genuinely unmapped (unknown comuna) — see `splitByFlagged`
 * below for why that can't just be read off `group.matchResult.flagged`.
 *
 * Row expansion lives in `PendingMobileOrderGroup`: a single-bulto order is
 * one compact row, a multi-bulto order is an order line plus one row per
 * package.
 */
export interface SendToDockRequest {
  packageIds: string[];
  /** Same order as packageIds — the audit trail's barcode field per package. */
  packageLabels: string[];
  /** BULTO-code for a single package, order number for a whole order. */
  code: string;
  comunaName: string | null;
  suggestedZone: ZoneGroup['zone'];
}

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

function countLabelFor(orders: OrderGroup[]): string {
  const total = orders.reduce((n, o) => n + o.packages.length, 0);
  return `${String(total).padStart(2, '0')} ${total === 1 ? 'pendiente' : 'pendientes'}`;
}

export function PendingMobileList({ groups, zones, canManualAssign, onRequestSend, now }: PendingMobileListProps) {
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
              <ZoneSection
                testId={`pending-group-${group.zone.id}-sin-anden`}
                zone={group.zone}
                orders={flaggedOrders}
                isFlagged
                canManualAssign={canManualAssign}
                onRequestSend={onRequestSend}
              />
            )}
            {normalOrders.length > 0 && (
              <ZoneSection
                testId={`pending-group-${group.zone.id}`}
                zone={group.zone}
                orders={normalOrders}
                isFlagged={false}
                canManualAssign={canManualAssign}
                onRequestSend={onRequestSend}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ZoneSection({
  testId,
  zone,
  orders,
  isFlagged,
  canManualAssign,
  onRequestSend,
}: {
  testId: string;
  zone: DockZoneRecord;
  orders: OrderGroup[];
  isFlagged: boolean;
  canManualAssign: boolean;
  onRequestSend: (request: SendToDockRequest) => void;
}) {
  const comunaNames = zone.comunas.map((c) => c.nombre).join(' · ');
  const headerLabel = isFlagged ? 'SIN ANDÉN' : zone.is_consolidation ? zone.name.toUpperCase() : `ANDÉN ${zone.code}`;
  const detailText = isFlagged
    ? 'Comuna sin mapear a un andén'
    : zone.is_consolidation
      ? 'Retenido hasta la fecha de entrega'
      : comunaNames || zone.name;

  return (
    <section data-testid={testId}>
      <header
        data-testid={`${testId.replace('pending-group-', 'pending-group-header-')}`}
        className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 ${
          isFlagged ? 'border-status-warning-border bg-status-warning-bg' : 'border-border bg-surface-raised'
        }`}
      >
        <span
          data-tone={isFlagged ? 'warning' : undefined}
          className={`font-mono text-[13px] font-bold uppercase tracking-[.1em] ${
            isFlagged ? 'text-status-warning-text' : 'text-text'
          }`}
        >
          {headerLabel}
        </span>
        <span
          className={`truncate text-[12.5px] ${isFlagged ? 'text-status-warning-text' : 'text-text-secondary'}`}
        >
          {detailText}
        </span>
        <span className="ml-auto flex-none font-mono text-[12.5px] tabular-nums text-text-secondary">
          {countLabelFor(orders)}
        </span>
      </header>

      <div className="mt-2 flex flex-col gap-2">
        {orders.map((order) => (
          <PendingMobileOrderGroup
            key={order.orderId}
            order={order}
            canManualAssign={canManualAssign}
            suggestedZone={zone}
            onRequestSend={onRequestSend}
          />
        ))}
      </div>
    </section>
  );
}
