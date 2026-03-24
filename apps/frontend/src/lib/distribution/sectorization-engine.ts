export interface DockZone {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  comunas: { id: string; nombre: string }[];
  is_active: boolean;
}

export interface PackageOrder {
  comunaId: string | null;
  delivery_date: string; // YYYY-MM-DD
}

export type ZoneMatchReason = 'matched' | 'future_date' | 'unmapped';

export interface ZoneMatchResult {
  zone_id: string;
  zone_name: string;
  zone_code: string;
  is_consolidation: boolean;
  reason: ZoneMatchReason;
  flagged: boolean;
}

function isDeliveryDateActive(deliveryDate: string, today: string): boolean {
  const delivery = new Date(deliveryDate + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return delivery <= tomorrow;
}

export function determineDockZone(
  pkg: PackageOrder,
  zones: DockZone[],
  today: string
): ZoneMatchResult {
  const consolidation = zones.find(z => z.is_consolidation);
  if (!consolidation) {
    throw new Error('No consolidation zone configured');
  }

  const makeResult = (zone: DockZone, reason: ZoneMatchReason, flagged = false): ZoneMatchResult => ({
    zone_id: zone.id,
    zone_name: zone.name,
    zone_code: zone.code,
    is_consolidation: zone.is_consolidation,
    reason,
    flagged,
  });

  if (!isDeliveryDateActive(pkg.delivery_date, today)) {
    return makeResult(consolidation, 'future_date');
  }

  if (pkg.comunaId) {
    const matchingZone = zones.find(
      z => !z.is_consolidation && z.is_active && z.comunas.some(c => c.id === pkg.comunaId)
    );
    if (matchingZone) {
      return makeResult(matchingZone, 'matched');
    }
  }

  // flagged=true when comunaId provided but no zone matched (known commune, unassigned andén)
  // flagged=false when comunaId is null (commune unmatched by DB trigger)
  return makeResult(consolidation, 'unmapped', pkg.comunaId !== null);
}
