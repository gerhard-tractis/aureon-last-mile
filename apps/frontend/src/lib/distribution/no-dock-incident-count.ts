import { determineDockZone } from './sectorization-engine';
import type { DockZone, PackageOrder } from './sectorization-engine';

/**
 * spec-96 fase 4 — `4a`'s "Sin andén asignado" incident row.
 *
 * A no-dock incident is an order whose comuna resolves (it is not the
 * unrecognised-comuna case, `get_unmatched_comunas`'s predicate) but no
 * active dock zone covers it — `determineDockZone`'s `flagged: true`
 * branch, the SAME predicate `PendingMobileList` (`4d`) already recomputes
 * per order rather than trusting the zone-bucket-level flag (spec-68 Fase 3
 * review, finding #5): the consolidation bucket legitimately mixes a
 * future-dated retention, a genuinely-unmapped comuna and a null-comuna
 * order under one `zone_id`, so only the per-order recompute tells them
 * apart.
 *
 * Deliberately NOT exported from `PendingMobileList.tsx` — that file is
 * Fase 2's surface; duplicating this ~5-line predicate here avoids a
 * cross-phase edit on a file this phase does not own.
 */
export function countNoDockIncidents(orders: PackageOrder[], zones: DockZone[], today: string): number {
  if (!zones.some((z) => z.is_consolidation)) return 0;
  return orders.filter((order) => {
    try {
      return determineDockZone(order, zones, today).flagged;
    } catch {
      return false;
    }
  }).length;
}
