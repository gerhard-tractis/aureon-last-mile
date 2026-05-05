'use client';
import { ManualAssignMenu } from './ManualAssignMenu';
import {
  formatRelativeDeliveryDate,
  type DeliveryDateTone,
} from '@/lib/distribution/relative-date';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type {
  OrderGroup,
  PendingPackage,
  SkuItem,
} from '@/hooks/distribution/usePendingSectorization';

type Density = 'detallado' | 'compacto';
const SKU_VISIBLE_CAP = 3;

export interface PendingDockListOrderGroupProps {
  order: OrderGroup;
  zoneCode: string;
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  onManualAssignAll?: (packageIds: string[], zoneId: string) => void;
  activeZones: DockZone[];
  density: Density;
  today: string;
}

export function PendingDockListOrderGroup({
  order,
  zoneCode,
  verifiedPackageIds,
  onTapVerify,
  onManualAssign,
  onManualAssignAll,
  activeZones,
  density,
  today,
}: PendingDockListOrderGroupProps) {
  const count = order.packages.length;
  const date = formatRelativeDeliveryDate(order.deliveryDate, today);

  return (
    <div data-testid={`order-group-${order.orderId}`} className="border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-2 px-0 py-1.5 bg-muted/30">
        <span className="font-manifest text-[11px] font-bold text-blue-500">
          Pedido #{order.orderNumber}
        </span>
        <span className="font-manifest text-[11px] text-muted-foreground">
          {count} {count === 1 ? 'bulto' : 'bultos'}
        </span>
        <span className={`font-manifest text-[11px] ${TONE_CLASS[date.tone]}`}>
          {date.label}
        </span>
        {order.comunaName && (
          <span className="font-manifest text-[11px] text-muted-foreground ml-auto">
            {order.comunaName}
          </span>
        )}
        {onManualAssignAll && (
          <div
            onClick={e => e.stopPropagation()}
            className={order.comunaName ? '' : 'ml-auto'}
          >
            <ManualAssignMenu
              activeZones={activeZones}
              triggerTestId="assign-all-btn"
              onSelect={selectedZoneId =>
                onManualAssignAll(
                  order.packages.map(p => p.id),
                  selectedZoneId
                )
              }
            />
          </div>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-y-0 divide-y divide-border/60 pl-4">
        {order.packages.map(pkg => (
          <PendingDockListRow
            key={pkg.id}
            pkg={pkg}
            zoneCode={zoneCode}
            verified={verifiedPackageIds.has(pkg.id)}
            onTapVerify={onTapVerify}
            onManualAssign={onManualAssign}
            activeZones={activeZones}
            density={density}
            today={today}
          />
        ))}
      </ul>
    </div>
  );
}

const TONE_CLASS: Record<DeliveryDateTone, string> = {
  overdue: 'text-status-error font-semibold',
  urgent: 'text-status-warning font-semibold',
  soon: 'text-foreground font-medium',
  neutral: 'text-muted-foreground',
};

interface PendingDockListRowProps {
  pkg: PendingPackage;
  zoneCode: string;
  verified: boolean;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  activeZones: DockZone[];
  density: Density;
  today: string;
}

function PendingDockListRow({
  pkg,
  zoneCode,
  verified,
  onTapVerify,
  onManualAssign,
  activeZones,
  density,
  today,
}: PendingDockListRowProps) {
  const handleClick = () => {
    if (verified) return;
    onTapVerify(pkg.id);
  };

  const date = formatRelativeDeliveryDate(pkg.delivery_date, today);
  const visibleSkus = pkg.skuItems.slice(0, SKU_VISIBLE_CAP);
  const hiddenCount = Math.max(0, pkg.skuItems.length - SKU_VISIBLE_CAP);
  const showSkus = density === 'detallado';

  return (
    <li
      data-testid={`pending-row-${pkg.id}`}
      data-state={verified ? 'verified' : 'pending'}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`group relative grid grid-cols-[3px_1fr_auto] gap-2 py-1.5 pr-1 transition-colors ${
        verified
          ? 'bg-status-success-bg/60 cursor-default'
          : 'hover:bg-accent/40 cursor-pointer'
      }`}
    >
      <span
        aria-hidden
        className={`block w-[3px] rounded-full ${
          verified ? 'bg-status-success' : 'bg-transparent'
        }`}
      />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-manifest text-[14px] font-semibold tabular-nums tracking-tight">
            {pkg.label}
          </span>
          <span
            className={`font-sans text-[12px] tabular-nums ${TONE_CLASS[date.tone]}`}
          >
            {date.label}
          </span>
          {pkg.comunaName && (
            <>
              <span className="text-muted-foreground/60 text-[11px]">·</span>
              <span className="font-sans text-[12px] text-muted-foreground">
                {pkg.comunaName}
              </span>
            </>
          )}
        </div>
        {showSkus && pkg.skuItems.length > 0 && (
          <div className="mt-1 pt-1 border-t border-dashed border-border/50 space-y-0.5">
            {visibleSkus.map((item, idx) => (
              <SkuLine key={`${item.sku}-${idx}`} item={item} />
            ))}
            {hiddenCount > 0 && (
              <div className="font-manifest text-[10px] uppercase tracking-wider text-muted-foreground/80 pl-6">
                +{hiddenCount} más
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-start gap-1 self-center">
        <span className="font-manifest text-[10px] uppercase tracking-[0.15em] text-muted-foreground border border-dashed border-border rounded px-1.5 py-0.5">
          {zoneCode}
        </span>
        {onManualAssign && (
          <div onClick={e => e.stopPropagation()}>
            <ManualAssignMenu
              activeZones={activeZones}
              onSelect={selectedZoneId => onManualAssign(pkg.id, selectedZoneId)}
            />
          </div>
        )}
      </div>
    </li>
  );
}

function SkuLine({ item }: { item: SkuItem }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="font-manifest tabular-nums text-muted-foreground w-5 shrink-0">
        {item.quantity}×
      </span>
      <span className="font-sans truncate text-foreground/80">
        {item.description || '—'}
      </span>
      <span className="font-manifest text-muted-foreground/70 ml-auto text-[10px] tabular-nums shrink-0">
        {item.sku}
      </span>
    </div>
  );
}
