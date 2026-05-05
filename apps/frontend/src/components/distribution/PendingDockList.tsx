'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Rows3, Rows } from 'lucide-react';
import { PendingDockListOrderGroup } from './PendingDockListOrderGroup';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';

type Density = 'detallado' | 'compacto';
const DENSITY_KEY = 'aureon-pending-density';

interface PendingDockListProps {
  groups: ZoneGroup[];
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  onManualAssignAll?: (packageIds: string[], zoneId: string) => void;
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
  onManualAssignAll,
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
      {groups.map(group => {
        const totalPackages = group.orders.reduce((n, o) => n + o.packages.length, 0);
        const countLabel = `${String(totalPackages).padStart(2, '0')} ${
          totalPackages === 1 ? 'pendiente' : 'pendientes'
        }`;
        return (
          <section key={group.zone.id} data-testid={`pending-group-${group.zone.id}`}>
            <header className="flex items-baseline gap-3 pb-1.5 mb-1.5 border-b border-border">
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
            <div className="grid grid-cols-1 gap-y-0 divide-y divide-border/60">
              {group.orders.map(order => (
                <PendingDockListOrderGroup
                  key={order.orderId}
                  order={order}
                  zoneId={group.zone.id}
                  zoneCode={group.zone.code}
                  verifiedPackageIds={verifiedPackageIds}
                  onTapVerify={onTapVerify}
                  onManualAssign={onManualAssign}
                  onManualAssignAll={onManualAssignAll}
                  activeZones={activeZones}
                  density={density}
                  today={today}
                />
              ))}
            </div>
          </section>
        );
      })}
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
        className="inline-flex rounded-md border border-border"
      >
        <button
          type="button"
          aria-pressed={!isCompact}
          aria-label="Vista detallada"
          title="Vista detallada"
          onClick={() => onChange('detallado')}
          className={`p-1 transition-colors ${
            !isCompact
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Rows3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-pressed={isCompact}
          aria-label="Vista compacta"
          title="Vista compacta"
          onClick={() => onChange('compacto')}
          className={`p-1 transition-colors border-l border-border ${
            isCompact
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Rows className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
