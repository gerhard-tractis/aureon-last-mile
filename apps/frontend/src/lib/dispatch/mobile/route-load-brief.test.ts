import { describe, it, expect } from 'vitest';
import {
  comunaBreakdown,
  countStops,
  countPendingOnDock,
  findIncompleteOrders,
  groupPackagesByOrder,
  type BriefDispatchRow,
  type BriefPackageRow,
} from './route-load-brief';

const dispatches: BriefDispatchRow[] = [
  { order_id: 'o1', order_number: 'ORD-001', contact_address: 'Calle 1, Santiago' },
  { order_id: 'o2', order_number: 'ORD-002', contact_address: 'Calle 2, Santiago' },
  { order_id: 'o3', order_number: 'ORD-003', contact_address: 'Calle 1, Santiago' }, // same stop as o1
];

describe('comunaBreakdown', () => {
  it('counts orders per comuna, sorted descending', () => {
    const comunaByOrder = new Map([
      ['o1', 'Santiago'],
      ['o2', 'Providencia'],
      ['o3', 'Santiago'],
    ]);
    expect(comunaBreakdown(dispatches, comunaByOrder)).toEqual([
      { comuna: 'Santiago', count: 2 },
      { comuna: 'Providencia', count: 1 },
    ]);
  });

  it('skips orders with no known comuna', () => {
    const comunaByOrder = new Map([['o1', null]]);
    expect(comunaBreakdown(dispatches, comunaByOrder)).toEqual([]);
  });
});

describe('countStops', () => {
  it('counts distinct delivery addresses, not orders', () => {
    expect(countStops(dispatches)).toBe(2);
  });

  it('excludes orders with no address on file', () => {
    const withMissing: BriefDispatchRow[] = [...dispatches, { order_id: 'o4', order_number: 'ORD-004', contact_address: null }];
    expect(countStops(withMissing)).toBe(2);
  });
});

describe('countPendingOnDock', () => {
  it('counts not-yet-loaded packages actually on the andén only', () => {
    const packages: BriefPackageRow[] = [
      { order_id: 'o1', status: 'sectorizado', loaded_at: null },
      { order_id: 'o1', status: 'asignado', loaded_at: '2026-09-03T10:00:00Z' }, // already loaded
      { order_id: 'o2', status: 'retenido', loaded_at: null }, // held in consolidation
      { order_id: 'o3', status: 'asignado', loaded_at: null },
      { order_id: 'o4', status: 'listo_para_despacho', loaded_at: null },
    ];
    expect(countPendingOnDock(packages)).toBe(3);
  });

  it('spec-76 review I4 — excludes en_bodega: a box that never reached the andén does not count', () => {
    const packages: BriefPackageRow[] = [{ order_id: 'o1', status: 'en_bodega', loaded_at: null }];
    expect(countPendingOnDock(packages)).toBe(0);
  });
});

describe('groupPackagesByOrder / findIncompleteOrders', () => {
  it('flags an order with a retenido sibling package', () => {
    const packages: BriefPackageRow[] = [
      { order_id: 'o1', status: 'en_bodega', loaded_at: null },
      { order_id: 'o1', status: 'retenido', loaded_at: null },
      { order_id: 'o2', status: 'en_bodega', loaded_at: null },
    ];
    const byOrder = groupPackagesByOrder(packages);
    expect(findIncompleteOrders(dispatches, byOrder)).toEqual([{ orderId: 'o1', orderNumber: 'ORD-001' }]);
  });

  it('does not flag an order twice even with multiple retained siblings', () => {
    const packages: BriefPackageRow[] = [
      { order_id: 'o1', status: 'retenido', loaded_at: null },
      { order_id: 'o1', status: 'retenido', loaded_at: null },
    ];
    const byOrder = groupPackagesByOrder(packages);
    expect(findIncompleteOrders(dispatches, byOrder)).toHaveLength(1);
  });

  it('returns an empty list when nothing is retained', () => {
    const packages: BriefPackageRow[] = [{ order_id: 'o1', status: 'en_bodega', loaded_at: null }];
    expect(findIncompleteOrders(dispatches, groupPackagesByOrder(packages))).toEqual([]);
  });
});
