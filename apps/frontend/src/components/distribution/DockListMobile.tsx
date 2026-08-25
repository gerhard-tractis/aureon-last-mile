'use client';

import { Warehouse } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { DockCapacityBar } from './DockCapacityBar';
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
 */
export interface DockListMobileProps {
  zones: DockZoneRecord[];
  sectorizedCounts: Record<string, number>;
}

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
              <span className="flex-none font-mono text-[15px] font-bold tabular-nums text-text">
                {count}
              </span>
            </div>
            <DockCapacityBar count={count} capacity={zone.capacity} />
          </div>
        );
      })}
    </div>
  );
}
