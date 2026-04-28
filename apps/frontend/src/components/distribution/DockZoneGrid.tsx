'use client';

import { ChevronUp, ChevronDown, Layers, MapPin, Package } from 'lucide-react';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';

interface DockZoneGridProps {
  zones: DockZoneRecord[];
  sectorizedCounts?: Record<string, number>;
  /** Called when the user clicks the up/down arrow on a row. Optional — when
   *  omitted the arrows are hidden (e.g. read-only views or tests). */
  onReorder?: (zoneId: string, direction: 'up' | 'down') => void;
  /** Disables both arrow buttons (e.g. while a reorder mutation is pending). */
  reorderPending?: boolean;
}

/**
 * Renders dock zones as a vertical list of rows (one per zone). Visual
 * pattern modelled on RouteActivityRow in dispatch/: rounded border + dot +
 * name/code + compact stat boxes, with up/down arrows on the right for
 * manual reordering.
 *
 * Name kept as DockZoneGrid for backwards-compatible imports, but the layout
 * is no longer a grid — it's a list.
 */
export function DockZoneGrid({ zones, sectorizedCounts, onReorder, reorderPending }: DockZoneGridProps) {
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
      {zones.map((zone, i) => {
        const count = sectorizedCounts?.[zone.id] ?? 0;
        const dotClass = !zone.is_active
          ? 'bg-text-muted'
          : count > 0
            ? 'bg-status-success shadow-[0_0_6px_var(--color-status-success)]'
            : 'bg-border';

        const isFirst = i === 0;
        const isLast = i === zones.length - 1;

        return (
          <div
            key={zone.id}
            className={cn(
              'flex items-center gap-3 sm:gap-4 rounded-xl border-[1.5px] border-border bg-surface px-4 py-3',
              !zone.is_active && 'opacity-60',
            )}
          >
            <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', dotClass)} aria-hidden="true" />

            {/* Name + code */}
            <div className="min-w-0 flex-1 sm:flex-none sm:w-48">
              <p className="text-sm font-bold text-text truncate">{zone.name}</p>
              <code className="text-[11px] text-text-secondary font-mono">{zone.code}</code>
              {!zone.is_active && (
                <span className="block text-[10px] text-text-muted mt-0.5">Inactivo</span>
              )}
            </div>

            {/* Stats — compact boxes, hide labels on very small screens to stay on one line */}
            <div className="flex gap-1.5 ml-auto sm:ml-0">
              <Stat icon={Package} value={count} label={count === 1 ? 'paquete' : 'paquetes'} accent={count > 0} />
              <Stat icon={MapPin} value={zone.comunas.length} label={zone.comunas.length === 1 ? 'comuna' : 'comunas'} />
            </div>

            {/* Reorder arrows — hidden for consolidation (always pinned at top)
                and when no handler is provided. */}
            {onReorder && !zone.is_consolidation && (
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  aria-label={`Mover ${zone.name} hacia arriba`}
                  disabled={isFirst || reorderPending}
                  onClick={() => onReorder(zone.id, 'up')}
                  className="p-1 rounded text-text-secondary hover:bg-surface-raised disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Mover ${zone.name} hacia abajo`}
                  disabled={isLast || reorderPending}
                  onClick={() => onReorder(zone.id, 'down')}
                  className="p-1 rounded text-text-secondary hover:bg-surface-raised disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            )}
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
