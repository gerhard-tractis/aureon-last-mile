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
 * Reads `dock_zones.capacity` through the shared `DockCapacityBar`, with
 * `showLabel={false}` — this tile prints its own single "N / M paq." line,
 * so the bar contributes only the fill track, never a second count and
 * never the "quedan N espacios" copy (that belongs to `4l` alone) — so a
 * zone with no capacity configured renders no bar, never one pinned at 0%.
 *
 * `4a` draws one capacity chip per tile from the set `CASI LLENO` /
 * `EN RITMO` / `DETENIDO` / `SIN ABRIR`. Only `CASI LLENO` is a capacity
 * state; the other three depend on per-zone open-batch and driver-assignment
 * data this grid's only caller (`distribution/page.tsx`) does not fetch per
 * zone — that wiring is Fase 4's, which owns that page. This grid renders
 * `CASI LLENO` for both the `warning` *and* `error` capacity tones: `4a` has
 * no tile at or above 100% fill, so the artboard is silent on a full dock,
 * and reusing the one chip it does draw is a declared choice, not an
 * invention — deliberately *without* the error border/background, which the
 * artboard reserves for a blocked dock (`DETENIDO`), never a full one.
 *
 * The `Activo`/`Inactivo` line is unchanged from before this phase. Its
 * `Inactivo` branch is unreachable from this grid's only caller today —
 * `distribution/page.tsx` filters to `is_active` zones before rendering —
 * but the prop contract itself allows it, so the text stays truthful rather
 * than assuming the filter forever.
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
        const capacityStatus = getDockCapacityStatus(count, zone.capacity);
        const nearFull = capacityStatus.tone === 'warning' || capacityStatus.tone === 'error';

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
              {nearFull && (
                <span
                  data-testid="outbound-dock-capacity-state"
                  data-state="warning"
                  className={cn(
                    'flex-none rounded bg-status-warning-bg px-1.5 py-1 font-mono text-[9.5px] font-semibold leading-none text-status-warning-text',
                    open > 0 ? '' : 'ml-auto',
                  )}
                >
                  CASI LLENO
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[22px] font-bold leading-none text-text">
                {count}
              </span>
              <span className="text-[11px] leading-none text-text-muted">
                {capacityStatus.configured ? `/ ${zone.capacity} paq.` : 'paq.'}
              </span>
            </div>

            <DockCapacityBar count={count} capacity={zone.capacity} showLabel={false} />

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
