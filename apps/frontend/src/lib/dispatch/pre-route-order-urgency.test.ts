import { describe, it, expect } from 'vitest';
import { sortOrdersByWindow, urgentOrderIds } from './pre-route-order-urgency';
import { buildGroups } from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import type { PreRouteAnden, PreRouteOrder } from '@/lib/types';

function order(over: Partial<PreRouteOrder> = {}): PreRouteOrder {
  return {
    id: 'o1',
    order_number: 'ORD-001',
    customer_name: 'Cliente Uno',
    delivery_address: 'Av. Siempre Viva 742',
    delivery_window_start: '08:00:00',
    delivery_window_end: '12:00:00',
    package_count: 2,
    has_split_dock_zone: false,
    ...over,
  };
}

function anden(): PreRouteAnden {
  return {
    id: 'a1',
    name: 'Sur Oriente',
    comunas_list: ['La Florida', 'Puente Alto'],
    order_count: 2,
    package_count: 4,
    order_ids: ['o1', 'o2'],
    has_split_dock_zone_warnings: false,
    comunas: [
      {
        id: 'c1',
        name: 'La Florida',
        order_count: 1,
        package_count: 2,
        orders: [order({ id: 'o1' })],
      },
      {
        id: 'c2',
        name: 'Puente Alto',
        order_count: 1,
        package_count: 2,
        orders: [order({ id: 'o2' })],
      },
    ],
  };
}

describe('sortOrdersByWindow', () => {
  const rows = buildGroups([anden()], 'anden')[0].orders;

  it('sorts ascending by windowEnd (I7: the same axis urgentOrderIds flags by, not windowStart)', () => {
    const [a, b] = [
      { ...rows[0], id: 'x', windowStart: '01:00:00', windowEnd: '14:00:00' },
      { ...rows[1], id: 'y', windowStart: '08:00:00', windowEnd: '09:00:00' },
    ];
    // y starts LATER than x but CLOSES earlier — sorting by windowStart
    // would put x first; sorting by windowEnd (the correct axis) puts y first.
    expect(sortOrdersByWindow([a, b]).map((o) => o.id)).toEqual(['y', 'x']);
  });

  it('pushes orders with no windowEnd to the end', () => {
    const [a, b] = [
      { ...rows[0], id: 'no-window', windowEnd: null },
      { ...rows[1], id: 'has-window', windowEnd: '09:00:00' },
    ];
    expect(sortOrdersByWindow([a, b]).map((o) => o.id)).toEqual(['has-window', 'no-window']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { ...rows[0], id: 'x', windowEnd: '14:00:00' },
      { ...rows[1], id: 'y', windowEnd: '09:00:00' },
    ];
    const copy = [...input];
    sortOrdersByWindow(input);
    expect(input).toEqual(copy);
  });
});

describe('urgentOrderIds', () => {
  const rows = buildGroups([anden()], 'anden')[0].orders;

  it('flags the order(s) whose window ends earliest', () => {
    const orders = [
      { ...rows[0], id: 'o1', windowEnd: '12:00:00' },
      { ...rows[1], id: 'o2', windowEnd: '10:00:00' },
    ];
    expect(urgentOrderIds(orders)).toEqual(new Set(['o2']));
  });

  it('flags every order tied for the earliest end time', () => {
    const orders = [
      { ...rows[0], id: 'o1', windowEnd: '10:00:00' },
      { ...rows[1], id: 'o2', windowEnd: '10:00:00' },
    ];
    expect(urgentOrderIds(orders)).toEqual(new Set(['o1', 'o2']));
  });

  it('ignores orders with no windowEnd', () => {
    const orders = [
      { ...rows[0], id: 'o1', windowEnd: null },
      { ...rows[1], id: 'o2', windowEnd: '10:00:00' },
    ];
    expect(urgentOrderIds(orders)).toEqual(new Set(['o2']));
  });

  it('returns an empty set when nothing has a windowEnd', () => {
    const orders = [
      { ...rows[0], id: 'o1', windowEnd: null },
      { ...rows[1], id: 'o2', windowEnd: null },
    ];
    expect(urgentOrderIds(orders)).toEqual(new Set());
  });

  it('flags a near (not just exact) tie within the urgency band', () => {
    // 10:00 and 10:30 are 30 minutes apart — both within the 60-minute
    // band, so both are urgent even though neither is the exact minimum
    // of the other. Degenerate exact-match logic would flag only o1.
    const orders = [
      { ...rows[0], id: 'o1', windowEnd: '10:00:00' },
      { ...rows[1], id: 'o2', windowEnd: '10:30:00' },
    ];
    expect(urgentOrderIds(orders)).toEqual(new Set(['o1', 'o2']));
  });

  it('excludes an order outside the urgency band even when it is otherwise soon', () => {
    const orders = [
      { ...rows[0], id: 'o1', windowEnd: '10:00:00' },
      { ...rows[1], id: 'o2', windowEnd: '11:01:00' }, // 61 minutes later — just outside the band
    ];
    expect(urgentOrderIds(orders)).toEqual(new Set(['o1']));
  });
});
