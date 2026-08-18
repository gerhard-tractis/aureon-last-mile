import { useMemo } from 'react';
import type { ScanRecord } from './usePickupScans';
import type { ManifestOrder } from './useManifestOrders';

export interface LatestScanResult {
  scan: ScanRecord | null;
  order: ManifestOrder | null;
  verifiedInOrder: number;
  totalInOrder: number;
}

/**
 * spec-54 mock 1h — derives the "Bloque de resultado" card's content from
 * the same `scans`/`orders` data the rest of the scan screen already uses.
 * No new query: `scans` (from `usePickupScans`) is ordered newest first, so
 * `scans[0]` is always the most recent scan attempt — of ANY outcome.
 *
 * Earlier revision only looked at the newest *verified* scan, which left a
 * stale green "Paquete verificado" card on screen after a not_found or
 * duplicate scan. The card now always reflects the true latest attempt;
 * `ScanResultCard` picks its palette from `scan.scan_result`.
 */
export function useLatestScanResult(
  scans: ScanRecord[],
  orders: ManifestOrder[]
): LatestScanResult {
  const scan = scans[0] ?? null;

  const order = useMemo(() => {
    if (!scan?.package_id) return null;
    return orders.find((o) => o.packages.some((p) => p.id === scan.package_id)) ?? null;
  }, [orders, scan]);

  const { verifiedInOrder, totalInOrder } = useMemo(() => {
    if (!order) return { verifiedInOrder: 0, totalInOrder: 0 };
    const orderPackageIds = new Set(order.packages.map((p) => p.id));
    const verifiedIds = new Set(
      scans
        .filter((s) => s.scan_result === 'verified' && s.package_id)
        .map((s) => s.package_id!)
    );
    return {
      verifiedInOrder: [...verifiedIds].filter((id) => orderPackageIds.has(id)).length,
      totalInOrder: order.packages.length,
    };
  }, [order, scans]);

  return { scan, order, verifiedInOrder, totalInOrder };
}
