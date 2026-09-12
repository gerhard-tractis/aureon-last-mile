'use client';

import { cn } from '@/lib/utils';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { DockCapacityBar } from './DockCapacityBar';
import { getDockCapacityStatus } from '@/lib/distribution/dock-capacity';

/**
 * spec-54 mock 3d, spec-96 fase 0 — "Andenes de salida" (`4a`).
 *
 * A denser tile than the one on Modo rápido (1d): that screen is read at three
 * metres while sorting, this one is scanned by a floor lead deciding where to
 * send people, so the code is 15px mono rather than 30px display.
 *
 * Reads `dock_zones.capacity` through the shared `DockCapacityBar` — the same
 * component `/andenes`, the quicksort step-2 screen and the `4e` send sheet
 * all read — so a zone with no capacity configured renders no bar, never one
 * pinned at 0%.
 *
 * `4a` draws one status chip per tile (`CASI LLENO` / `EN RITMO` / `DETENIDO`
 * / `SIN ABRIR`). Two of those are capacity states (already sourced from
 * `dock-capacity.ts`'s tone); the other two would need a driver/route
 * assignment this app has no query for, so this grid derives its chip from
 * what it does have — capacity tone first, then `openBatches` and
 * `zone.is_active` — distinguishable via
 * `data-testid="outbound-dock-activity"`'s `data-state` attribute, never by
 * asserting its copy.
 */

interface OutboundDockGridProps {
  zones: DockZoneRecord[];
  sectorizedCounts?: Record<string, number>;
  /** Open lote count per dock zone id. */
  openBatches?: Record<string, number>;
}

type OutboundDockState = 'full' | 'warning' | 'inactive' | 'open' | 'idle';

const STATE_LABEL: Record<OutboundDockState, string> = {
  full: 'LLENO',
  warning: 'CASI LLENO',
  inactive: 'INACTIVO',
  open: 'EN RITMO',
  idle: 'SIN ABRIR',
};

const STATE_CLASS: Record<OutboundDockState, string> = {
  full: 'bg-status-error-bg text-status-error-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  inactive: 'bg-surface-raised text-text-muted',
  open: 'bg-status-success-bg text-status-success-text',
  idle: 'bg-surface-raised text-text-muted',
};

function dockState(
  tone: ReturnType<typeof getDockCapacityStatus>['tone'],
  isActive: boolean,
  open: number,
): OutboundDockState {
  if (tone === 'error') return 'full';
  if (tone === 'warning') return 'warning';
  if (!isActive) return 'inactive';
  if (open > 0) return 'open';
  return 'idle';
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
        const capacityStatus = getDockCapacityStatus(count, zone.capacity);
        const state = dockState(capacityStatus.tone, zone.is_active, open);

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
              <span
                data-testid="outbound-dock-activity"
                data-state={state}
                className={cn(
                  'ml-auto flex-none rounded px-1.5 py-1 font-mono text-[9.5px] font-semibold leading-none',
                  STATE_CLASS[state],
                )}
              >
                {STATE_LABEL[state]}
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[22px] font-bold leading-none text-text">
                {count}
              </span>
              <span className="text-[11px] leading-none text-text-muted">paq.</span>
            </div>

            <DockCapacityBar count={count} capacity={zone.capacity} />
          </div>
        );
      })}
    </div>
  );
}
