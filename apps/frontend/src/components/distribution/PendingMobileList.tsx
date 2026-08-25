'use client';

import { Card, CardContent } from '@/components/ui/card';
import { PendingMobileOrderGroup } from './PendingMobileOrderGroup';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';

/**
 * spec-68 Fase 3 — `4d`, pendientes de sectorizar, below `lg`.
 *
 * Grouped by the andén the engine computed (`usePendingSectorization`
 * already returns this shape — no new query). The bucket whose
 * `matchResult.flagged` is true (unmapped comuna) renders as SIN ANDÉN in
 * the warning palette instead of a normal andén header, even though its
 * `zone_id` happens to point at consolidación (see
 * `determineDockZone`'s 'unmapped' branch).
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
  /** Gates every ⋯ affordance — mirrors useManualDockAssignment.canUse. */
  canManualAssign: boolean;
  onRequestSend: (request: SendToDockRequest) => void;
}

export function PendingMobileList({ groups, canManualAssign, onRequestSend }: PendingMobileListProps) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-text-secondary">
          No hay paquetes pendientes en este momento.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const totalPackages = group.orders.reduce((n, o) => n + o.packages.length, 0);
        const countLabel = `${String(totalPackages).padStart(2, '0')} ${
          totalPackages === 1 ? 'pendiente' : 'pendientes'
        }`;
        const isFlagged = group.matchResult.flagged;
        const comunaNames = group.zone.comunas.map((c) => c.nombre).join(' · ');

        return (
          <section key={group.zone.id} data-testid={`pending-group-${group.zone.id}`}>
            <header
              data-testid={`pending-group-header-${group.zone.id}`}
              className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 ${
                isFlagged
                  ? 'border-status-warning-border bg-status-warning-bg'
                  : 'border-border bg-surface-raised'
              }`}
            >
              <span
                data-tone={isFlagged ? 'warning' : undefined}
                className={`font-mono text-[13px] font-bold uppercase tracking-[.1em] ${
                  isFlagged ? 'text-status-warning-text' : 'text-text'
                }`}
              >
                {isFlagged ? 'SIN ANDÉN' : `ANDÉN ${group.zone.code}`}
              </span>
              <span
                className={`truncate text-[12.5px] ${
                  isFlagged ? 'text-status-warning-text' : 'text-text-secondary'
                }`}
              >
                {isFlagged ? 'Comuna sin mapear a un andén' : comunaNames || group.zone.name}
              </span>
              <span className="ml-auto flex-none font-mono text-[12.5px] tabular-nums text-text-secondary">
                {countLabel}
              </span>
            </header>

            <div className="mt-2 flex flex-col gap-2">
              {group.orders.map((order) => (
                <PendingMobileOrderGroup
                  key={order.orderId}
                  order={order}
                  canManualAssign={canManualAssign}
                  suggestedZone={group.zone}
                  onRequestSend={onRequestSend}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
