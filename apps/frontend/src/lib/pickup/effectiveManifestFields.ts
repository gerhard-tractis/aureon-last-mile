import type { ManifestCacheRecord } from '@/lib/offline/manifest-cache';

export interface NetworkManifestFields {
  manifestId: string | null;
  totalPackages: number;
  pickupRouteId: string | null;
  retailerName: string | null;
  pickupPoint: string | null;
}

/**
 * spec-82 fase 2 (ronda 3, extraído de `scan/[loadId]/page.tsx` para bajar
 * su tamaño) — sin red, el snapshot local reemplaza por completo los
 * campos del manifiesto que el fetch de red no pudo traer. Con red,
 * `snapshot` es siempre `null` (ver `useOfflineScanSource`) y esta función
 * devuelve `network` sin tocarlo — el flujo online no cambia.
 */
export function effectiveManifestFields(
  snapshot: ManifestCacheRecord | null,
  network: NetworkManifestFields,
): NetworkManifestFields {
  if (!snapshot) return network;
  return {
    manifestId: snapshot.manifestId,
    totalPackages: snapshot.totalPackages ?? 0,
    pickupRouteId: snapshot.pickupRouteId,
    retailerName: snapshot.retailerName,
    pickupPoint: snapshot.pickupLocation,
  };
}
