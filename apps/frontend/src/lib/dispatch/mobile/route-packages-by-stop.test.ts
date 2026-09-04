import { describe, it, expect } from 'vitest';
import {
  groupPackagesByStop,
  groupPackagesByHour,
  findIncompleteFilterState,
  filterStopGroupsToIncomplete,
  filterHourGroupsToIncomplete,
  type RawDispatchRow,
  type RawPackageRow,
} from './route-packages-by-stop';

const dispatches: RawDispatchRow[] = [
  { dispatch_id: 'd1', order_id: 'o1', order_number: 'ORD-1', contact_address: 'Los Aromos 442', client_name: 'Javiera Muñoz' },
  { dispatch_id: 'd2', order_id: 'o2', order_number: 'ORD-2', contact_address: 'Av. Kennedy 5001', client_name: 'Pedro Salas' },
];

const packages: RawPackageRow[] = [
  { id: 'p1', order_id: 'o1', label: 'CL8841881', package_number: '1 de 2', status: 'en_carga', loaded_at: '2026-09-03T14:07:00.000Z' },
  { id: 'p2', order_id: 'o1', label: 'CL8841882', package_number: '2 de 2', status: 'en_carga', loaded_at: '2026-09-03T14:22:00.000Z' },
  { id: 'p3', order_id: 'o2', label: 'CL8841883', package_number: null, status: 'en_carga', loaded_at: '2026-09-03T15:01:00.000Z' },
  { id: 'p4', order_id: 'o2', label: 'CL8841884', package_number: null, status: 'retenido', loaded_at: null },
];

describe('groupPackagesByStop', () => {
  it('spec-76 2h #18 — groups by stop, alphabetical address order, with a loaded package count', () => {
    const groups = groupPackagesByStop(dispatches, packages);
    expect(groups).toHaveLength(2);
    // "Av. Kennedy 5001" sorts before "Los Aromos 442" — stopIndexByOrder's
    // own alphabetical rule (route-load-brief.ts).
    expect(groups[0]).toMatchObject({ stopIndex: 1, address: 'Av. Kennedy 5001', packageCount: 1 });
    expect(groups[1]).toMatchObject({ stopIndex: 2, address: 'Los Aromos 442', packageCount: 2 });
  });

  it('renders barcode, order, package_number and client on each package row', () => {
    const groups = groupPackagesByStop(dispatches, packages);
    const stop2 = groups.find((g) => g.stopIndex === 2)!;
    expect(stop2.packages).toContainEqual(
      expect.objectContaining({
        barcode: 'CL8841881',
        orderNumber: 'ORD-1',
        packageNumber: '1 de 2',
        clientName: 'Javiera Muñoz',
        loaded: true,
      }),
    );
  });

  it('spec-76 2h #20 — a retenido package shows NO EMBARCADO on its own stop, not counted toward packageCount', () => {
    const groups = groupPackagesByStop(dispatches, packages);
    const stop1 = groups.find((g) => g.stopIndex === 1)!;
    expect(stop1.packageCount).toBe(1); // only p3 is loaded
    expect(stop1.packages).toHaveLength(2); // p3 + p4 (retenido)
    const retained = stop1.packages.find((p) => p.packageId === 'p4')!;
    expect(retained.notEmbarked).toBe(true);
    expect(retained.loaded).toBe(false);
  });

  it('excludes an order with no address on file rather than inventing a stop 0', () => {
    const noAddress: RawDispatchRow[] = [
      { dispatch_id: 'd3', order_id: 'o3', order_number: 'ORD-3', contact_address: null, client_name: null },
    ];
    const pkgs: RawPackageRow[] = [
      { id: 'p5', order_id: 'o3', label: 'CL1', package_number: null, status: 'en_carga', loaded_at: '2026-09-03T10:00:00.000Z' },
    ];
    expect(groupPackagesByStop(noAddress, pkgs)).toEqual([]);
  });
});

describe('groupPackagesByHour', () => {
  it('groups loaded packages by hour (America/Santiago), ascending, with a trailing unloaded bucket', () => {
    const groups = groupPackagesByHour(dispatches, packages);
    // 14:07Z and 14:22Z are both in the 14:00 UTC hour, which is 11:00 in
    // America/Santiago (UTC-3 in September, daylight saving observed).
    const hourLabels = groups.map((g) => g.hourLabel);
    expect(hourLabels[hourLabels.length - 1]).toBeNull(); // the retenido one, trailing
    expect(groups[groups.length - 1].packages).toHaveLength(1);
    expect(groups[groups.length - 1].packages[0].packageId).toBe('p4');
    // Ascending by hour label for the loaded ones.
    const loadedLabels = hourLabels.filter((l): l is string => l !== null);
    expect(loadedLabels).toEqual([...loadedLabels].sort());
  });
});

describe('findIncompleteFilterState / filter*ToIncomplete', () => {
  it('spec-76 2h #18 — flags o2 incomplete (has a retenido sibling) and o1 not', () => {
    const packagesByOrder = new Map([
      ['o1', packages.filter((p) => p.order_id === 'o1')],
      ['o2', packages.filter((p) => p.order_id === 'o2')],
    ]);
    const { incompleteOrders, incompleteOrderIds } = findIncompleteFilterState(dispatches, packagesByOrder);
    expect(incompleteOrders).toEqual([{ orderId: 'o2', orderNumber: 'ORD-2' }]);
    expect(incompleteOrderIds.has('o2')).toBe(true);
    expect(incompleteOrderIds.has('o1')).toBe(false);
  });

  it('filterStopGroupsToIncomplete drops stops with nothing left and recomputes packageCount', () => {
    const groups = groupPackagesByStop(dispatches, packages);
    const filtered = filterStopGroupsToIncomplete(groups, new Set(['o2']));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].address).toBe('Av. Kennedy 5001');
    expect(filtered[0].packages).toHaveLength(2); // p3 + p4
    expect(filtered[0].packageCount).toBe(1); // only p3 loaded
  });

  it('filterHourGroupsToIncomplete drops buckets with nothing left', () => {
    const groups = groupPackagesByHour(dispatches, packages);
    const filtered = filterHourGroupsToIncomplete(groups, new Set(['o2']));
    for (const g of filtered) {
      for (const p of g.packages) expect(p.orderId).toBe('o2');
    }
  });
});
