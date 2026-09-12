'use client';

import { cn } from '@/lib/utils';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { DockCapacityBar } from './DockCapacityBar';
import { getDockCapacityStatus } from '@/lib/distribution/dock-capacity';

/**
 * spec-54 mock 3d, spec-96 fase 0/4 — "Andenes de salida" (`4a`).
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
 * `4a` draws exactly one chip per tile, from `CASI LLENO` / `EN RITMO` /
 * `DETENIDO` / `SIN ABRIR`. Precedence, fixed in fase 0's review: capacity
 * tone over activity — a near-full dock reads `CASI LLENO` even with a lote
 * open. `DETENIDO` (a blocked dock, no driver assigned) is NOT implemented
 * here — fase 4 confirmed no pre-load zone↔route join exists to source it:
 * `dock_batches` carries no driver, and `packages.loaded_route_id` is only
 * populated after staging (post-load). This is a declared gap, not a
 * proxy — never invented from `is_active` or anything else.
 *
 * `openBatches` is a real per-zone count now (`useOpenBatchesByZone`), fed
 * by `distribution/page.tsx`. A prior fase 0 attempt used the page's
 * `openBatches` prop, which was a page-level scalar for the header
 * subtitle, not a per-zone record — that would have shown `SIN ABRIR` on
 * every active dock in production, so it was reverted before this phase.
 *
 * The tile footer's route codes (`R-2481 · R-2483`) have no source either
 * — `useDockZones`'s `DockZoneRecord` carries no route field — so the left
 * side of the footer states what IS known (the open-lote count, or that
 * none is open) instead of inventing a route list. The right side is the
 * per-state action, matching the artboard's `Ver`/`Abrir` (never
 * `Asignar`, since that belongs to the unbuilt `DETENIDO` state).
 */

type ChipState = 'near-full' | 'active' | 'unopened';

const CHIP_LABEL: Record<ChipState, string> = {
  'near-full': 'CASI LLENO',
  active: 'EN RITMO',
  unopened: 'SIN ABRIR',
};

const CHIP_CLASSNAME: Record<ChipState, string> = {
  'near-full': 'bg-status-warning-bg text-status-warning-text',
  active: 'bg-status-success-bg text-status-success-text',
  unopened: 'bg-surface-raised text-text-secondary',
};

const BORDER_CLASSNAME: Record<ChipState, string> = {
  'near-full': 'border-border border-t-[3px] border-t-status-warning',
  active: 'border-border border-t-[3px] border-t-status-success',
  unopened: 'border-border border-t-[3px] border-t-border-strong',
};

function chipStateFor(nearFull: boolean, open: number): ChipState {
  if (nearFull) return 'near-full';
  if (open > 0) return 'active';
  return 'unopened';
}

interface OutboundDockGridProps {
  zones: DockZoneRecord[];
  sectorizedCounts?: Record<string, number>;
  /** Open lote count per dock zone id (useOpenBatchesByZone). */
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
        const chipState = chipStateFor(nearFull, open);

        return (
          <div
            key={zone.id}
            data-testid="outbound-dock"
            className={cn(
              'flex flex-col gap-2.5 rounded-[11px] border bg-surface p-3.5',
              consolidation
                ? 'border-status-warning-border border-t-[3px] border-t-status-warning'
                : BORDER_CLASSNAME[chipState],
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
              {!consolidation && (
                <span
                  data-testid="outbound-dock-chip"
                  data-state={chipState}
                  className={cn(
                    'ml-auto flex-none rounded px-1.5 py-1 font-mono text-[9.5px] font-semibold leading-none',
                    CHIP_CLASSNAME[chipState],
                  )}
                >
                  {CHIP_LABEL[chipState]}
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
                {open > 0 ? `${open} ${open === 1 ? 'lote' : 'lotes'} en curso` : 'lote sin abrir'}
              </span>
              <span className="ml-auto flex-none text-[10.5px] font-semibold leading-none text-accent">
                {open > 0 ? 'Ver' : 'Abrir'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
