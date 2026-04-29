'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ManualAssignMenu } from './ManualAssignMenu';
import {
  formatRelativeDeliveryDate,
  type DeliveryDateTone,
} from '@/lib/distribution/relative-date';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type {
  ZoneGroup,
  PendingPackage,
  SkuItem,
} from '@/hooks/distribution/usePendingSectorization';

type Density = 'detallado' | 'compacto';
const DENSITY_KEY = 'aureon-pending-density';
const SKU_VISIBLE_CAP = 3;

interface PendingDockListProps {
  groups: ZoneGroup[];
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  activeZones: DockZone[];
}

function readStoredDensity(): Density {
  if (typeof window === 'undefined') return 'detallado';
  const stored = window.localStorage.getItem(DENSITY_KEY);
  return stored === 'compacto' ? 'compacto' : 'detallado';
}

export function PendingDockList({
  groups,
  verifiedPackageIds,
  onTapVerify,
  onManualAssign,
  activeZones,
}: PendingDockListProps) {
  const [density, setDensity] = useState<Density>(readStoredDensity);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  const today = new Date().toISOString().split('T')[0];

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No hay paquetes pendientes en este momento.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <DensityToggle value={density} onChange={setDensity} />
      {groups.map(group => (
        <PendingDockListGroup
          key={group.zone.id}
          group={group}
          verifiedPackageIds={verifiedPackageIds}
          onTapVerify={onTapVerify}
          onManualAssign={onManualAssign}
          activeZones={activeZones}
          density={density}
          today={today}
        />
      ))}
    </div>
  );
}

function DensityToggle({
  value,
  onChange,
}: {
  value: Density;
  onChange: (next: Density) => void;
}) {
  const isCompact = value === 'compacto';
  return (
    <div className="flex justify-end">
      <div
        role="group"
        aria-label="Densidad de la lista"
        className="inline-flex rounded-md border border-border text-xs font-manifest uppercase tracking-wider"
      >
        <button
          type="button"
          aria-pressed={!isCompact}
          onClick={() => onChange('detallado')}
          className={`px-3 py-1 transition-colors ${
            !isCompact
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Detallado
        </button>
        <button
          type="button"
          aria-pressed={isCompact}
          onClick={() => onChange('compacto')}
          className={`px-3 py-1 transition-colors border-l border-border ${
            isCompact
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Compacto
        </button>
      </div>
    </div>
  );
}

interface PendingDockListGroupProps {
  group: ZoneGroup;
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  activeZones: DockZone[];
  density: Density;
  today: string;
}

function PendingDockListGroup({
  group,
  verifiedPackageIds,
  onTapVerify,
  onManualAssign,
  activeZones,
  density,
  today,
}: PendingDockListGroupProps) {
  const count = group.packages.length;
  const countLabel = `${String(count).padStart(2, '0')} ${
    count === 1 ? 'pendiente' : 'pendientes'
  }`;

  return (
    <section data-testid={`pending-group-${group.zone.id}`}>
      <header className="flex items-baseline gap-3 pb-2 mb-2 border-b border-border">
        <span className="font-manifest text-[11px] font-semibold tracking-[0.18em] uppercase text-foreground">
          {group.zone.name}
        </span>
        <span className="font-manifest text-[11px] text-muted-foreground">
          ▸ {group.zone.code}
        </span>
        <span className="ml-auto font-manifest text-[11px] text-muted-foreground tabular-nums">
          {countLabel}
        </span>
      </header>
      <ul className="divide-y divide-border/60">
        {group.packages.map(pkg => (
          <PendingDockListRow
            key={pkg.id}
            pkg={pkg}
            zoneCode={group.zone.code}
            verified={verifiedPackageIds.has(pkg.id)}
            onTapVerify={onTapVerify}
            onManualAssign={onManualAssign}
            activeZones={activeZones}
            density={density}
            today={today}
          />
        ))}
      </ul>
    </section>
  );
}

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

const TONE_CLASS: Record<DeliveryDateTone, string> = {
  overdue: 'text-status-error font-semibold',
  urgent: 'text-status-warning font-semibold',
  soon: 'text-foreground font-medium',
  neutral: 'text-muted-foreground',
};

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
      className={`group relative grid grid-cols-[3px_1fr_auto] gap-3 py-2.5 pr-2 transition-colors ${
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
      <div className="min-w-0 space-y-1">
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
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-manifest text-[11px] tabular-nums">
            #{pkg.orderNumber}
          </span>
        </div>
        {showSkus && pkg.skuItems.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-dashed border-border/50 space-y-0.5">
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
              packageId={pkg.id}
              activeZones={activeZones}
              onSelect={zoneId => onManualAssign(pkg.id, zoneId)}
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
