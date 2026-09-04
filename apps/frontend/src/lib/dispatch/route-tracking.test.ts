import { describe, it, expect } from 'vitest';
import { buildRouteTrackingSummary, type TrackingDispatchRow, type TrackingPackageRow } from './route-tracking';

const dispatches: TrackingDispatchRow[] = [
  { order_id: 'ord-1', order_number: 'ORD-1', comuna: 'Ñuñoa', address: 'Calle 1', customerName: 'Ana' },
  { order_id: 'ord-2', order_number: 'ORD-2', comuna: 'Providencia', address: 'Calle 2', customerName: 'Beto' },
];

function pkg(overrides: Partial<TrackingPackageRow> = {}): TrackingPackageRow {
  return {
    id: 'p1',
    order_id: 'ord-1',
    label: 'LBL-1',
    loaded_at: null,
    loaded_by: null,
    status: 'sectorizado',
    ...overrides,
  };
}

describe('buildRouteTrackingSummary', () => {
  it('returns newest-first scans, only for loaded packages', () => {
    const packages: TrackingPackageRow[] = [
      pkg({ id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' }),
      pkg({ id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: null, loaded_by: null }),
      pkg({ id: 'p3', order_id: 'ord-2', label: 'LBL-3', loaded_at: '2026-09-04T10:05:00Z', loaded_by: 'u1' }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.scans.map((s) => s.packageId)).toEqual(['p3', 'p1']);
    expect(summary.packagesLoadedCount).toBe(2);
    expect(summary.packagesExpectedCount).toBe(3);
    expect(summary.packagesUnscannedCount).toBe(1);
  });

  it('numbers boxIndexInOrder / boxesTotalInOrder within an order, by loaded_at order', () => {
    const packages: TrackingPackageRow[] = [
      pkg({ id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' }),
      pkg({ id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: '2026-09-04T10:01:00Z', loaded_by: 'u1' }),
      pkg({ id: 'p3', order_id: 'ord-1', label: 'LBL-3', loaded_at: null, loaded_by: null }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    const first = summary.scans.find((s) => s.packageId === 'p1')!;
    const second = summary.scans.find((s) => s.packageId === 'p2')!;
    expect(first.boxIndexInOrder).toBe(1);
    expect(second.boxIndexInOrder).toBe(2);
    expect(first.boxesTotalInOrder).toBe(3);
    expect(second.boxesTotalInOrder).toBe(3);
  });

  /**
   * Phase-4 review deviation fix — `stopNumber` must agree with the SAME
   * number the crew's phone already shows for the same box:
   * `mobile/route-load-brief.ts`'s `stopIndexByOrder` (distinct delivery
   * address, sorted alphabetically), not dock-arrival order. `ord-2`
   * ("Calle 2") arrives on the dock FIRST here, but `ord-1` ("Calle 1")
   * still gets stop 1 — alphabetical order, unrelated to scan timing.
   */
  it('ranks stopNumber the same way the crew mobile screen does — by address, alphabetically, not by dock-arrival order', () => {
    const packages: TrackingPackageRow[] = [
      // ord-2 arrives on the dock first even though "Calle 1" sorts before
      // "Calle 2" — stopNumber must still follow the address, not this.
      pkg({ id: 'p1', order_id: 'ord-2', label: 'LBL-1', loaded_at: '2026-09-04T09:00:00Z', loaded_by: 'u1' }),
      pkg({ id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: '2026-09-04T09:05:00Z', loaded_by: 'u1' }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    const ord2Scan = summary.scans.find((s) => s.packageId === 'p1')!;
    const ord1Scan = summary.scans.find((s) => s.packageId === 'p2')!;
    expect(ord1Scan.stopNumber).toBe(1); // "Calle 1"
    expect(ord2Scan.stopNumber).toBe(2); // "Calle 2"
  });

  it('lists pendingOrders for any order with at least one unloaded live package', () => {
    const packages: TrackingPackageRow[] = [
      pkg({ id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' }),
      pkg({ id: 'p2', order_id: 'ord-2', label: 'LBL-2', loaded_at: null, loaded_by: null }),
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
      pkg({ id: 'p1', order_id: 'ord-orphan', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1' }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.scans).toEqual([]);
    expect(summary.packagesExpectedCount).toBe(0);
  });

  /**
   * Phase-4 review CRITICAL — a package that is neither loaded nor still
   * `DISPATCHABLE_STATUSES` (retenido, dañado, entregado, ...) cannot ever
   * become loaded, so it must not count toward "esperados", must not keep
   * its order stuck in "Ver los N pendientes" forever, and must not cap
   * `boxesTotalInOrder` below what the crew's phone / `/seal` consider
   * complete. Same rule `useRoutePackages.ts` already applies.
   */
  it('excludes a retenido package entirely — never loaded, never dispatchable, never "sin escanear" forever', () => {
    const packages: TrackingPackageRow[] = [
      pkg({ id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1', status: 'en_carga' }),
      pkg({ id: 'p2', order_id: 'ord-1', label: 'LBL-2', loaded_at: null, loaded_by: null, status: 'retenido' }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    // Only the loaded box counts — the retenido one is invisible to the
    // summary, so the order reads as complete (1 de 1), not "1 de 2 · 1 sin escanear".
    expect(summary.packagesExpectedCount).toBe(1);
    expect(summary.packagesLoadedCount).toBe(1);
    expect(summary.packagesUnscannedCount).toBe(0);
    expect(summary.pendingOrders).toEqual([]);
    expect(summary.scans[0].boxesTotalInOrder).toBe(1);
  });

  it('keeps a loaded package in scope even once its status has moved past DISPATCHABLE_STATUSES', () => {
    const packages: TrackingPackageRow[] = [
      pkg({ id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1', status: 'en_carga' }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.packagesLoadedCount).toBe(1);
    expect(summary.packagesExpectedCount).toBe(1);
  });

  it('excludes a never-loaded package with a non-dispatchable status (dañado) from "esperados"', () => {
    const packages: TrackingPackageRow[] = [
      pkg({ id: 'p1', order_id: 'ord-1', label: 'LBL-1', loaded_at: null, loaded_by: null, status: 'dañado' }),
    ];
    const summary = buildRouteTrackingSummary(dispatches, packages);
    expect(summary.packagesExpectedCount).toBe(0);
    expect(summary.pendingOrders).toEqual([]);
  });
});
