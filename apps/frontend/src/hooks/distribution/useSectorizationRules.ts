import { determineDockZone, type ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

export function getSectorizationResult(
  zona: string,
  deliveryDate: string,
  zones: DockZone[],
  today: string
): ZoneMatchResult {
  return determineDockZone({ comuna: zona, delivery_date: deliveryDate }, zones, today);
}

export type { ZoneMatchResult };
