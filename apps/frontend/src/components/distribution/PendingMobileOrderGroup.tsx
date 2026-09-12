'use client';

import {
  formatRelativeDeliveryDate,
  type DeliveryDateTone,
} from '@/lib/distribution/relative-date';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import type { OrderGroup, PendingPackage } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import type { SendToDockRequest } from './PendingMobileList';
import { SendAffordance, OrderActionSlot, SelectCheckbox } from './PendingOrderActionSlot';

const TONE_CLASS: Record<DeliveryDateTone, string> = {
  overdue: 'text-status-error font-semibold',
  urgent: 'text-status-warning font-semibold',
  soon: 'text-foreground font-medium',
  neutral: 'text-text-secondary',
};

export interface PendingMobileOrderGroupProps {
  order: OrderGroup;
  canManualAssign: boolean;
  suggestedZone: DockZoneRecord;
  onRequestSend: (request: SendToDockRequest) => void;
  /**
   * spec-96 Fase 2 — `4d`'s DET/CMP control. `'det'` (default) is today's
   * shape: a single-bulto order is one compact row, a multi-bulto order
   * expands into an order line plus one row per package. `'cmp'` forces
   * every order — regardless of bulto count — into one compact row.
   */
  mode?: 'det' | 'cmp';
  /**
   * spec-96 Fase 2 — `4d`'s SEL control. When true, the order-level ⋯
   * affordance is replaced by a checkbox; the per-package ⋯ inside an
   * expanded order is untouched, because SEL selects whole orders, not
   * individual bultos.
   */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function PendingMobileOrderGroup({
  order,
  canManualAssign,
  suggestedZone,
  onRequestSend,
  mode = 'det',
  selectable = false,
  selected = false,
  onToggleSelect,
}: PendingMobileOrderGroupProps) {
  // spec-68 Fase 3 review (finding #8) — was the UTC date via
  // `new Date().toISOString().split('T')[0]`, the same bug Fase 2 fixed in
  // DistributionMobileView's todayISOFrom: past ~20:00 in Santiago the UTC
  // calendar date has already rolled to tomorrow, mis-scoring a same-day
  // delivery as overdue.
  const today = todayISOInTimezone();
  const date = formatRelativeDeliveryDate(order.deliveryDate, today);

  // spec-96 Fase 2 — `4d`'s CMP forces every order into this same compact
  // shape a single-bulto order already used, regardless of bulto count.
  const isSingle = order.packages.length === 1;
  const isCompact = mode === 'cmp' || isSingle;

  if (isCompact) {
    const pkg = isSingle ? order.packages[0] : undefined;
    // spec-96 Fase 2 review (Task 2.4) — `4d`'s compact row leads with the
    // order, not the barcode: `Distribucion.dc.html:620-621` draws
    // "ORD-48219" as the headline with no barcode anywhere in that row,
    // for a genuinely single-bulto order. The barcode still surfaces in
    // DET's expanded per-package rows below, where the operator is
    // choosing among several.
    const headline = `Pedido #${order.orderNumber}`;
    const comunaName = pkg ? pkg.comunaName : order.comunaName;
    const sendLabel = pkg
      ? `Enviar ${pkg.label} a andén`
      : `Enviar pedido ${order.orderNumber} a andén`;
    const handleSend = () =>
      onRequestSend(
        pkg
          ? {
              packageIds: [pkg.id],
              packageLabels: [pkg.label],
              code: pkg.label,
              comunaName: pkg.comunaName,
              suggestedZone,
            }
          : {
              packageIds: order.packages.map((p) => p.id),
              packageLabels: order.packages.map((p) => p.label),
              code: order.orderNumber,
              comunaName: order.comunaName,
              suggestedZone,
            },
      );

    return (
      <div
        data-testid={`pending-order-${order.orderId}`}
        className="flex min-h-[52px] items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2"
      >
        {selectable && (
          <SelectCheckbox
            label={`Seleccionar pedido ${order.orderNumber}`}
            checked={selected}
            onChange={() => onToggleSelect?.()}
          />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[14px] font-semibold tabular-nums tracking-tight text-text">
              {headline}
            </span>
            <span className={`text-[12px] tabular-nums ${TONE_CLASS[date.tone]}`}>{date.label}</span>
          </div>
          <div className="flex items-baseline gap-2 text-[12px] text-text-secondary">
            <span>
              {order.packages.length} {order.packages.length === 1 ? 'bulto' : 'bultos'}
            </span>
            {comunaName && (
              <>
                <span aria-hidden="true">·</span>
                <span>{comunaName}</span>
              </>
            )}
          </div>
        </div>
        {!selectable && (
          <OrderActionSlot canManualAssign={canManualAssign} sendLabel={sendLabel} onSend={handleSend} />
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={`pending-order-${order.orderId}`}
      className="flex min-h-[44px] flex-col gap-1 rounded-lg border border-border bg-surface p-2"
    >
      <div className="flex min-h-[44px] items-center gap-2.5 border-b border-border/60 pb-1.5">
        {selectable && (
          <SelectCheckbox
            label={`Seleccionar pedido ${order.orderNumber}`}
            checked={selected}
            onChange={() => onToggleSelect?.()}
          />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-status-info">Pedido #{order.orderNumber}</span>
            <span className="text-[12px] text-text-secondary">
              {order.packages.length} bultos
            </span>
            <span className={`text-[12px] tabular-nums ${TONE_CLASS[date.tone]}`}>{date.label}</span>
          </div>
          {order.comunaName && (
            <span className="text-[12px] text-text-secondary">{order.comunaName}</span>
          )}
        </div>
        {!selectable && (
          <OrderActionSlot
            canManualAssign={canManualAssign}
            sendLabel={`Enviar pedido ${order.orderNumber} a andén`}
            onSend={() =>
              onRequestSend({
                packageIds: order.packages.map((p) => p.id),
                packageLabels: order.packages.map((p) => p.label),
                code: order.orderNumber,
                comunaName: order.comunaName,
                suggestedZone,
              })
            }
          />
        )}
      </div>

      <div className="flex flex-col gap-1 pl-3">
        {order.packages.map((pkg) => (
          <PendingMobilePackageRow
            key={pkg.id}
            pkg={pkg}
            // spec-96 Fase 2 — SEL selects whole orders; a per-bulto send
            // mid-selection would let one bulto leave the batch its
            // checkbox says it's part of. Suppressed here rather than
            // added as a second selectable target.
            canManualAssign={canManualAssign && !selectable}
            suggestedZone={suggestedZone}
            onRequestSend={onRequestSend}
            today={today}
          />
        ))}
      </div>
    </div>
  );
}

function PendingMobilePackageRow({
  pkg,
  canManualAssign,
  suggestedZone,
  onRequestSend,
  today,
}: {
  pkg: PendingPackage;
  canManualAssign: boolean;
  suggestedZone: DockZoneRecord;
  onRequestSend: (request: SendToDockRequest) => void;
  today: string;
}) {
  const date = formatRelativeDeliveryDate(pkg.delivery_date, today);
  return (
    <div
      data-testid={`pending-package-${pkg.id}`}
      className="flex min-h-[44px] items-center gap-2.5 py-1"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-[13px] font-semibold tabular-nums tracking-tight text-text">
            {pkg.label}
          </span>
          <span className={`text-[11.5px] tabular-nums ${TONE_CLASS[date.tone]}`}>{date.label}</span>
        </div>
      </div>
      {canManualAssign && (
        <SendAffordance
          label={`Enviar ${pkg.label} a andén`}
          onClick={() =>
            onRequestSend({
              packageIds: [pkg.id],
              packageLabels: [pkg.label],
              code: pkg.label,
              comunaName: pkg.comunaName,
              suggestedZone,
            })
          }
        />
      )}
    </div>
  );
}
