import { describe, it, expect } from 'vitest';
import { buildRouteTrackingSummary, type TrackingDispatchRow, type TrackingPackageRow } from './route-tracking';

const dispatches: TrackingDispatchRow[] = [
  { order_id: 'ord-1', order_number: 'ORD-1', comuna: 'Ñuñoa', address: 'Calle 1', customerName: 'Ana' },
  { order_id: 'ord-2', order_number: 'ORD-2', comuna: 'Providencia', address: 'Calle 2', customerName: 'Beto' },
];

describe('buildRouteTrackingSummary', () => {
  it('returns newest-first scans, only for loaded packages', () => {
    const packages: TrackingPackageRow[] = [
      { id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' },
      { id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: null, loaded_by: null },
      { id: 'p3', order_id: 'ord-2', label: 'LBL-3', loaded_at: '2026-09-04T10:05:00Z', loaded_by: 'u1' },
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.scans.map((s) => s.packageId)).toEqual(['p3', 'p1']);
    expect(summary.packagesLoadedCount).toBe(2);
    expect(summary.packagesExpectedCount).toBe(3);
    expect(summary.packagesUnscannedCount).toBe(1);
  });

  it('numbers boxIndexInOrder / boxesTotalInOrder within an order, by loaded_at order', () => {
    const packages: TrackingPackageRow[] = [
      { id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' },
      { id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: '2026-09-04T10:01:00Z', loaded_by: 'u1' },
      { id: 'p3', order_id: 'ord-1', label: 'LBL-3', loaded_at: null, loaded_by: null },
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    const first = summary.scans.find((s) => s.packageId === 'p1')!;
    const second = summary.scans.find((s) => s.packageId === 'p2')!;
    expect(first.boxIndexInOrder).toBe(1);
    expect(second.boxIndexInOrder).toBe(2);
    expect(first.boxesTotalInOrder).toBe(3);
    expect(second.boxesTotalInOrder).toBe(3);
  });

  it('ranks stopNumber by which order arrived on the dock first, not route order', () => {
    const packages: TrackingPackageRow[] = [
      // ord-2 arrives first even though it is second in `dispatches`.
      { id: 'p1', order_id: 'ord-2', label: 'LBL-1', loaded_at: '2026-09-04T09:00:00Z', loaded_by: 'u1' },
      { id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: '2026-09-04T09:05:00Z', loaded_by: 'u1' },
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    const ord2Scan = summary.scans.find((s) => s.packageId === 'p1')!;
    const ord1Scan = summary.scans.find((s) => s.packageId === 'p2')!;
    expect(ord2Scan.stopNumber).toBe(1);
    expect(ord1Scan.stopNumber).toBe(2);
  });

  it('lists pendingOrders for any order with at least one unloaded live package', () => {
    const packages: TrackingPackageRow[] = [
      { id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' },
      { id: 'p2', order_id: 'ord-2', label: 'LBL-2', loaded_at: null, loaded_by: null },
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.pendingOrders).toEqual([{ orderId: 'ord-2', orderNumber: 'ORD-2', comuna: 'Providencia' }]);
  });

  it('handles an empty route with no packages at all', () => {
    const summary = buildRouteTrackingSummary([], []);
    expect(summary).toEqual({
      scans: [],
      packagesLoadedCount: 0,
      packagesExpectedCount: 0,
      packagesUnscannedCount: 0,
      pendingOrders: [],
    });
  });

  it('ignores a package whose order is not on this route (defensive)', () => {
    const packages: TrackingPackageRow[] = [
      { id: 'p1', order_id: 'ord-orphan', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' },
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.scans).toEqual([]);
    expect(summary.packagesExpectedCount).toBe(0);
  });
});
