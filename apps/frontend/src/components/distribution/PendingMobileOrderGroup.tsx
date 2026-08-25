'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  formatRelativeDeliveryDate,
  type DeliveryDateTone,
} from '@/lib/distribution/relative-date';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type { OrderGroup, PendingPackage } from '@/hooks/distribution/usePendingSectorization';
import type { SendToDockRequest } from './PendingMobileList';

const TONE_CLASS: Record<DeliveryDateTone, string> = {
  overdue: 'text-status-error font-semibold',
  urgent: 'text-status-warning font-semibold',
  soon: 'text-foreground font-medium',
  neutral: 'text-text-secondary',
};

export interface PendingMobileOrderGroupProps {
  order: OrderGroup;
  canManualAssign: boolean;
  suggestedZone: DockZone;
  onRequestSend: (request: SendToDockRequest) => void;
}

/** The ⋯ affordance — 44px square, icon-only, named for the a11y tree. */
function SendAffordance({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 flex-none place-items-center rounded-full text-text-secondary transition-colors active:bg-surface-raised"
    >
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

export function PendingMobileOrderGroup({
  order,
  canManualAssign,
  suggestedZone,
  onRequestSend,
}: PendingMobileOrderGroupProps) {
  const today = new Date().toISOString().split('T')[0];
  const date = formatRelativeDeliveryDate(order.deliveryDate, today);

  if (order.packages.length === 1) {
    const pkg = order.packages[0];
    return (
      <div
        data-testid={`pending-order-${order.orderId}`}
        className="flex min-h-[52px] items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[14px] font-semibold tabular-nums tracking-tight text-text">
              {pkg.label}
            </span>
            <span className={`text-[12px] tabular-nums ${TONE_CLASS[date.tone]}`}>{date.label}</span>
          </div>
          <div className="flex items-baseline gap-2 text-[12px] text-text-secondary">
            <span>Pedido #{order.orderNumber}</span>
            {pkg.comunaName && (
              <>
                <span aria-hidden="true">·</span>
                <span>{pkg.comunaName}</span>
              </>
            )}
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

  return (
    <div
      data-testid={`pending-order-${order.orderId}`}
      className="flex min-h-[44px] flex-col gap-1 rounded-lg border border-border bg-surface p-2"
    >
      <div className="flex min-h-[44px] items-center gap-2.5 border-b border-border/60 pb-1.5">
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
        {canManualAssign && (
          <SendAffordance
            label={`Enviar pedido ${order.orderNumber} a andén`}
            onClick={() =>
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
            canManualAssign={canManualAssign}
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
  suggestedZone: DockZone;
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
