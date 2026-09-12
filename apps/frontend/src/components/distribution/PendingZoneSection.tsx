'use client';

import { PendingMobileOrderGroup } from './PendingMobileOrderGroup';
import type { OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import type { SendToDockRequest } from '@/lib/distribution/pending-selection';

function countLabelFor(orders: OrderGroup[]): string {
  const total = orders.reduce((n, o) => n + o.packages.length, 0);
  return `${total} ${total === 1 ? 'pendiente' : 'pendientes'}`;
}

/**
 * spec-68 Fase 3 — one andén's (or SIN ANDÉN's) header plus its rows,
 * extracted from `PendingMobileList` so that file stays under the file
 * length floor. `mode`/`selectionMode` are `4d`'s DET/CMP and SEL controls
 * (spec-96 Fase 2), passed straight through to each order row.
 *
 * spec-96 Fase 2 review (Task 2.4) — the header used to be a `rounded-lg`
 * card (`bg-surface-raised`, or a warning-tinted box when flagged). `4d`
 * (`Distribucion.dc.html:609-612,660-664`) draws it as a plain baseline
 * row with a bottom border, same neutral border in both states — only the
 * label's text colour marks SIN ANDÉN, not a filled box. The count is
 * un-padded ("14 pendientes", not "14 pendientes" zero-filled to two
 * digits) and the detail line is `▸ {zone.name} · {comunas}`, not a bare
 * comuna list.
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
  const headerLabel = isFlagged
    ? 'SIN ANDÉN ASIGNADO'
    : zone.is_consolidation
      ? zone.name.toUpperCase()
      : `ANDÉN ${zone.code}`;
  const detailText = isFlagged
    ? '▸ comuna sin mapear'
    : zone.is_consolidation
      ? '▸ retenido hasta su fecha'
      : `▸ ${zone.name}${comunaNames ? ` · ${comunaNames}` : ''}`;

  return (
    <section data-testid={testId}>
      <header
        data-testid={`${testId.replace('pending-group-', 'pending-group-header-')}`}
        className="flex items-baseline gap-2 border-b border-border pb-[7px]"
      >
        <span
          data-tone={isFlagged ? 'warning' : undefined}
          className={`font-mono text-[11px] font-semibold uppercase tracking-[.16em] ${
            isFlagged ? 'text-status-warning-text' : 'text-text'
          }`}
        >
          {headerLabel}
        </span>
        <span className="truncate text-[11px] text-text-secondary">{detailText}</span>
        <span className="ml-auto flex-none font-mono text-[11px] tabular-nums text-text-secondary">
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
