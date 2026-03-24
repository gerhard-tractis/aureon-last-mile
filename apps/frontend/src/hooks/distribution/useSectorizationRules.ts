import { determineDockZone, type ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

export function getSectorizationResult(
  comunaId: string | null,
  deliveryDate: string,
  zones: DockZone[],
  today: string
): ZoneMatchResult {
  return determineDockZone({ comunaId, delivery_date: deliveryDate }, zones, today);
}

export type { ZoneMatchResult };
