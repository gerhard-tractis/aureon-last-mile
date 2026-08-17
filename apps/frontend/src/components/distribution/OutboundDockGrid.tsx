'use client';

import { cn } from '@/lib/utils';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-54 mock 3d — "Andenes de salida".
 *
 * A denser tile than the one on Modo rápido (1d): that screen is read at three
 * metres while sorting, this one is scanned by a floor lead deciding where to
 * send people, so the code is 15px mono rather than 30px display.
 *
 * The mock shows a capacity denominator ("168 / 180 paq."), a fill bar and a
 * CASI LLENO badge. dock_zones has no capacity column, so the count is shown
 * without a denominator and the bar is omitted — the same choice DockCard
 * makes. Adding `dock_zones.capacity` is what would unlock all three, and it
 * needs an admin surface to set it, so it is a follow-up rather than a guess.
 */

interface OutboundDockGridProps {
  zones: DockZoneRecord[];
  sectorizedCounts?: Record<string, number>;
  /** Open lote count per dock zone id. */
  openBatches?: Record<string, number>;
}

export function OutboundDockGrid({
  zones,
  sectorizedCounts,
  openBatches,
}: OutboundDockGridProps) {
  return (
    <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {zones.map((zone) => {
        const count = sectorizedCounts?.[zone.id] ?? 0;
        const open = openBatches?.[zone.id] ?? 0;
        const consolidation = zone.is_consolidation;

        return (
          <div
            key={zone.id}
            data-testid="outbound-dock"
            className={cn(
              'flex flex-col gap-2.5 rounded-[11px] border bg-surface p-3.5',
              consolidation
                ? 'border-status-warning-border border-t-[3px] border-t-status-warning'
                : open > 0
                  ? 'border-border border-t-[3px] border-t-status-success'
                  : 'border-border border-t-[3px] border-t-border',
            )}
          >
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  'font-mono text-[15px] font-bold leading-none',
                  consolidation ? 'text-status-warning-text' : 'text-text',
                )}
              >
                {zone.code}
              </span>
              <span className="min-w-0 truncate text-[11px] leading-none text-text-secondary">
                {consolidation
                  ? 'Consolidación'
                  : zone.comunas.map((c) => c.nombre).join(' · ') || zone.name}
              </span>
              {open > 0 && (
                <span className="ml-auto flex-none rounded bg-status-success-bg px-1.5 py-1 font-mono text-[9.5px] font-semibold leading-none text-status-success-text">
                  {open} {open === 1 ? 'LOTE' : 'LOTES'}
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[22px] font-bold leading-none text-text">
                {count}
              </span>
              <span className="text-[11px] leading-none text-text-muted">paq.</span>
            </div>

            <div className="mt-auto flex items-center gap-2">
              <span className="truncate text-[10.5px] leading-none text-text-muted">
                {zone.is_active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
