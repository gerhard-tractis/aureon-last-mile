'use client';

import { Layers, MapPin, Package } from 'lucide-react';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';

interface DockZoneGridProps {
  zones: DockZoneRecord[];
  sectorizedCounts?: Record<string, number>;
}

export function DockZoneGrid({ zones, sectorizedCounts }: DockZoneGridProps) {
  if (zones.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Sin andenes activos"
        description="Todos los andenes están inactivos. Activa al menos uno para ver la grilla de distribución."
        action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
      />
    );
  }

  return (
    <div className="space-y-2">
      {zones.map((zone) => {
        const count = sectorizedCounts?.[zone.id] ?? 0;
        const dotClass = !zone.is_active
          ? 'bg-text-muted'
          : count > 0
            ? 'bg-status-success shadow-[0_0_6px_var(--color-status-success)]'
            : 'bg-border';

        return (
          <div
            key={zone.id}
            className={cn(
              'flex items-center gap-3 sm:gap-4 rounded-xl border-[1.5px] border-border bg-surface px-4 py-3',
              !zone.is_active && 'opacity-60',
            )}
          >
            <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', dotClass)} aria-hidden="true" />

            <div className="min-w-0 flex-1 sm:flex-none sm:w-48">
              <p className="text-sm font-bold text-text truncate">{zone.name}</p>
              <code className="text-[11px] text-text-secondary font-mono">{zone.code}</code>
              {!zone.is_active && (
                <span className="block text-[10px] text-text-muted mt-0.5">Inactivo</span>
              )}
            </div>

            <div className="flex gap-1.5 ml-auto sm:ml-0">
              <Stat icon={Package} value={count} label={count === 1 ? 'paquete' : 'paquetes'} accent={count > 0} />
              <Stat icon={MapPin} value={zone.comunas.length} label={zone.comunas.length === 1 ? 'comuna' : 'comunas'} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface StatProps {
  icon: typeof Package;
  value: number;
  label: string;
  accent?: boolean;
}

function Stat({ icon: Icon, value, label, accent }: StatProps) {
  return (
    <div className="text-center bg-surface-raised border border-border rounded-lg px-3 py-1.5 min-w-[58px]">
      <p className={cn('text-base font-bold font-mono tabular-nums', accent && 'text-status-success')}>{value}</p>
      <p className="text-[10px] text-text-secondary mt-0.5 flex items-center justify-center gap-0.5">
        <Icon className="h-2.5 w-2.5" />
        <span>{label}</span>
      </p>
    </div>
  );
}
