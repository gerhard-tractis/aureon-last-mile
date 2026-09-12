'use client';

import { Warehouse } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { DockCapacityBar } from './DockCapacityBar';
import { getDockCapacityStatus } from '@/lib/distribution/dock-capacity';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 6 (Decisión 3) — the list `/app/distribution/andenes` is
 * built around. `4c`'s PROCESOS DE LA NAVE row promises an "Andenes"
 * destination the canvas never drew; rather than invent a screen, this is
 * exactly what the spec calls for: one row per ACTIVE andén — code, zone
 * name, sectorized count, and the fill bar only where `capacity` is
 * configured (`DockCapacityBar` already renders nothing without it). No
 * new query — `zones` and `sectorizedCounts` are the same
 * `useDockZones` / `useSectorizedByZone` data every other distribution
 * screen already reads. No map, no card grid: the desktop `DockCard` grid
 * becomes an endless scroll column at 390px, which is why this is a list.
 *
 * The consolidation zone belongs in the list, marked as such (its own
 * subtitle), not hidden — it's still an andén crew look for.
 *
 * spec-96 Fase 8 (`4l`) — `A6`, the unconfigured-capacity row, is a
 * first-class state, not a degraded fallback: no bar (`DockCapacityBar`
 * already renders nothing without a configured capacity), and its own
 * `dock-capacity-unconfigured` region says so instead. The status chip is
 * capacity-derived only, the same two states `getDockCapacityStatus`
 * exposes — `unconfigured` when capacity is unset, `near-full` when it's
 * configured and the fill tone is `warning`/`error`. `4l`'s other two chip
 * texts (`EN RITMO`, and an equivalent for a stalled dock) depend on
 * per-zone open-batch/activity data this list does not receive — same open
 * finding as `OutboundDockGrid`'s (`4a`) — so a configured zone in the
 * neutral tone renders no chip at all rather than a guessed one.
 */
export interface DockListMobileProps {
  zones: DockZoneRecord[];
  sectorizedCounts: Record<string, number>;
}

type ChipState = 'unconfigured' | 'near-full';

function chipStateFor(count: number, capacity: number | null): ChipState | null {
  const status = getDockCapacityStatus(count, capacity);
  if (!status.configured) return 'unconfigured';
  if (status.tone === 'warning' || status.tone === 'error') return 'near-full';
  return null;
}

const CHIP_LABEL: Record<ChipState, string> = {
  unconfigured: 'SIN ABRIR',
  'near-full': 'CASI LLENO',
};

export function DockListMobile({ zones, sectorizedCounts }: DockListMobileProps) {
  const activeZones = zones.filter((z) => z.is_active);

  if (activeZones.length === 0) {
    return (
      <EmptyState
        icon={Warehouse}
        title="Sin andenes configurados"
        description="Configura tus andenes para ver su ocupación aquí."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {activeZones.map((zone) => {
        const count = sectorizedCounts[zone.id] ?? 0;
        const configured = zone.capacity != null && zone.capacity > 0;
        const chipState = chipStateFor(count, zone.capacity);
        return (
          <div
            key={zone.id}
            data-testid={`dock-list-row-${zone.id}`}
            className="flex min-h-[64px] flex-col justify-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5"
          >
            <div className="flex items-center gap-3">
              <span className="flex-none rounded-md bg-surface-raised px-2 py-1 font-mono text-[13px] font-bold text-text">
                {zone.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">
                {zone.name}
              </span>
              {zone.is_consolidation && (
                <span className="flex-none rounded-sm border border-status-info-border bg-status-info-bg px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-status-info">
                  Consolidación
                </span>
              )}
              {chipState && (
                <span
                  data-testid="dock-status-chip"
                  data-state={chipState}
                  className="flex-none rounded-sm px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em]"
                >
                  {CHIP_LABEL[chipState]}
                </span>
              )}
              <span className="flex-none font-mono text-[15px] font-bold tabular-nums text-text">
                {count}
              </span>
            </div>
            {configured ? (
              <DockCapacityBar count={count} capacity={zone.capacity} />
            ) : (
              <div
                data-testid="dock-capacity-unconfigured"
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-xs font-semibold text-text-muted">{count} bultos</span>
                <span className="text-[11px] text-text-muted">sin barra hasta configurar</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
