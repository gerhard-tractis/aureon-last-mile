import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestScanResult } from './useLatestScanResult';
import type { ScanRecord } from './usePickupScans';
import type { ManifestOrder } from './useManifestOrders';

const order: ManifestOrder = {
  id: 'o1',
  order_number: 'ORD-1',
  customer_name: 'María López',
  comuna: 'Providencia',
  delivery_address: 'Av. Siempre Viva 123',
  packages: [
    { id: 'pkg1', label: 'CTN001', package_number: '1', sku_items: [], declared_weight_kg: null },
    { id: 'pkg2', label: 'CTN002', package_number: '2', sku_items: [], declared_weight_kg: null },
  ],
};

describe('useLatestScanResult', () => {
  it('returns nulls and zeros when there are no scans yet', () => {
    const { result } = renderHook(() => useLatestScanResult([], []));
    expect(result.current).toEqual({
      scan: null,
      order: null,
      verifiedInOrder: 0,
      totalInOrder: 0,
    });
  });

  it('picks the newest scan regardless of outcome — scans arrive newest first', () => {
    // A not_found scan after an earlier verified one must not be masked by
    // the verified one — this is exactly the "stale success" bug.
    const scans: ScanRecord[] = [
      { id: 's2', barcode_scanned: 'CTN999', scan_result: 'not_found', scanned_at: '2026-01-01T00:01:00Z', package_id: null },
      { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-01-01T00:00:00Z', package_id: 'pkg1' },
    ];
    const { result } = renderHook(() => useLatestScanResult(scans, [order]));
    expect(result.current.scan?.id).toBe('s2');
    expect(result.current.scan?.scan_result).toBe('not_found');
  });

  it('matches the scanned package to its order and counts verified progress within it', () => {
    const scans: ScanRecord[] = [
      { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-01-01T00:00:00Z', package_id: 'pkg1' },
    ];
    const { result } = renderHook(() => useLatestScanResult(scans, [order]));
    expect(result.current.order?.id).toBe('o1');
    expect(result.current.verifiedInOrder).toBe(1);
    expect(result.current.totalInOrder).toBe(2);
  });

  it('leaves order null when the latest scan has no package_id (not_found)', () => {
    const scans: ScanRecord[] = [
      { id: 's1', barcode_scanned: 'CTN999', scan_result: 'not_found', scanned_at: '2026-01-01T00:00:00Z', package_id: null },
    ];
    const { result } = renderHook(() => useLatestScanResult(scans, [order]));
    expect(result.current.order).toBeNull();
    expect(result.current.verifiedInOrder).toBe(0);
    expect(result.current.totalInOrder).toBe(0);
  });

  it('matches order context for a duplicate scan that carries a package_id', () => {
    const scans: ScanRecord[] = [
      { id: 's1', barcode_scanned: 'CTN001', scan_result: 'duplicate', scanned_at: '2026-01-01T00:00:00Z', package_id: 'pkg1' },
    ];
    const { result } = renderHook(() => useLatestScanResult(scans, [order]));
    expect(result.current.order?.id).toBe('o1');
  });
});
