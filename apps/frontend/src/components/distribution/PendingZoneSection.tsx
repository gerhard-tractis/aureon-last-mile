'use client';

import { PendingMobileOrderGroup } from './PendingMobileOrderGroup';
import type { OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import type { SendToDockRequest } from '@/lib/distribution/pending-selection';

function countLabelFor(orders: OrderGroup[]): string {
  const total = orders.reduce((n, o) => n + o.packages.length, 0);
  return `${String(total).padStart(2, '0')} ${total === 1 ? 'pendiente' : 'pendientes'}`;
}

/**
 * spec-68 Fase 3 — one andén's (or SIN ANDÉN's) header plus its rows,
 * extracted from `PendingMobileList` so that file stays under the file
 * length floor. `mode`/`selectionMode` are `4d`'s DET/CMP and SEL controls
 * (spec-96 Fase 2), passed straight through to each order row.
 */
export function PendingZoneSection({
  testId,
  zone,
  orders,
  isFlagged,
  canManualAssign,
  onRequestSend,
  mode,
  selectionMode,
  selectedOrderIds,
  onToggleOrderSelection,
}: {
  testId: string;
  zone: DockZoneRecord;
  orders: OrderGroup[];
  isFlagged: boolean;
  canManualAssign: boolean;
  onRequestSend: (request: SendToDockRequest) => void;
  mode: 'det' | 'cmp';
  selectionMode: boolean;
  selectedOrderIds: Set<string>;
  onToggleOrderSelection: (orderId: string) => void;
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
            mode={mode}
            selectable={selectionMode}
            selected={selectedOrderIds.has(order.orderId)}
            onToggleSelect={() => onToggleOrderSelection(order.orderId)}
          />
        ))}
      </div>
    </section>
  );
}
