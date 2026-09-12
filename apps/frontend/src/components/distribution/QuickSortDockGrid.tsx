'use client';

import { DockCard } from './DockCard';
import { getDockCapacityStatus } from '@/lib/distribution/dock-capacity';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-96 fase 0 review — extracted from `quicksort/page.tsx` (`4b`) purely
 * to keep that file under the 300-line cap; no behaviour moved with it.
 *
 * One `DockCard` per active zone, occupancy derived from
 * `dock_zones.capacity` via `getDockCapacityStatus(...).fillPct` — a zone
 * with no capacity configured yields `null`, passed through as `undefined`
 * so `DockCard` renders no bar rather than one pinned at 0%.
 */
interface QuickSortDockGridProps {
  zones: DockZoneRecord[];
  sectorizedByZone: Record<string, number> | undefined;
  /** Dock code of the last successful scan, to highlight its tile. */
  activeZoneCode?: string;
}

export function QuickSortDockGrid({
  zones,
  sectorizedByZone,
  activeZoneCode,
}: QuickSortDockGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {zones.map((zone) => {
        const count = sectorizedByZone?.[zone.id] ?? 0;
        const capacityStatus = getDockCapacityStatus(count, zone.capacity);
        return (
          <DockCard
            key={zone.id}
            code={zone.code}
            zoneName={zone.name}
            comunas={zone.comunas.map((c) => c.nombre)}
            packageCount={count}
            occupancyPct={capacityStatus.fillPct ?? undefined}
            tone={zone.is_consolidation ? 'warning' : 'neutral'}
            active={activeZoneCode === zone.code}
          />
        );
      })}
    </div>
  );
}
