import { describe, it, expect } from 'vitest';
import {
  buildGroups,
  summariseOrderSelection,
  groupSelectionState,
  toggleGroupSelection,
  allOrderIds,
  sortOrdersByWindow,
  urgentOrderIds,
} from './useUnroutedGroups';
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

function anden(over: Partial<PreRouteAnden> = {}): PreRouteAnden {
  return {
    id: 'a1',
    name: 'Sur Oriente',
    comunas_list: ['La Florida', 'Puente Alto'],
    order_count: 62,
    package_count: 148,
    order_ids: ['o1', 'o2'],
    has_split_dock_zone_warnings: false,
    comunas: [
      {
        id: 'c1',
        name: 'La Florida',
        order_count: 40,
        package_count: 96,
        orders: [order({ id: 'o1', order_number: 'ORD-001', package_count: 2 })],
      },
      {
        id: 'c2',
        name: 'Puente Alto',
        order_count: 22,
        package_count: 52,
        orders: [order({ id: 'o2', order_number: 'ORD-002', package_count: 3 })],
      },
    ],
    ...over,
  };
}

describe('buildGroups — por andén', () => {
  it('returns one group per andén, flattening its comunas into order rows', () => {
    const groups = buildGroups([anden()], 'anden');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'a1', name: 'Sur Oriente', orderCount: 62, packageCount: 148 });
    expect(groups[0].orders.map((o) => o.id)).toEqual(['o1', 'o2']);
  });

  it('attaches each order row the comuna name of its parent, not the andén', () => {
    const groups = buildGroups([anden()], 'anden');
    expect(groups[0].orders[0].comunaName).toBe('La Florida');
    expect(groups[0].orders[1].comunaName).toBe('Puente Alto');
  });

  it('carries the full order-row shape the design needs', () => {
    const [row] = buildGroups([anden()], 'anden')[0].orders;
    expect(row).toEqual({
      id: 'o1',
      orderNumber: 'ORD-001',
      comunaName: 'La Florida',
      address: 'Av. Siempre Viva 742',
      packageCount: 2,
      windowStart: '08:00:00',
      windowEnd: '12:00:00',
      hasSplitDockZone: false,
    });
  });

  it('describes the andén by the comunas it covers', () => {
    expect(buildGroups([anden()], 'anden')[0].subtitle).toBe('La Florida · Puente Alto');
  });

  it('surfaces the split-dock-zone warning', () => {
    const groups = buildGroups([anden({ has_split_dock_zone_warnings: true })], 'anden');
    expect(groups[0].warning).toBe(true);
  });
});

describe('buildGroups — por comuna', () => {
  it("flattens andenes into one group per comuna, carrying that comuna's own orders", () => {
    const groups = buildGroups([anden()], 'comuna');
    expect(groups.map((g) => g.name)).toEqual(['La Florida', 'Puente Alto']);
    expect(groups[0].orderCount).toBe(40);
    expect(groups[0].packageCount).toBe(96);
    expect(groups[0].orders.map((o) => o.id)).toEqual(['o1']);
  });

  it('merges a comuna that appears under more than one andén, concatenating its orders', () => {
    const a = anden({
      id: 'a1',
      comunas: [
        { id: 'c1', name: 'Maipú', order_count: 10, package_count: 20, orders: [order({ id: 'o1' })] },
      ],
      order_ids: ['o1'],
    });
    const b = anden({
      id: 'a2',
      comunas: [
        { id: 'c1', name: 'Maipú', order_count: 5, package_count: 8, orders: [order({ id: 'o2' })] },
      ],
      order_ids: ['o2'],
    });
    const groups = buildGroups([a, b], 'comuna');
    expect(groups).toHaveLength(1);
    expect(groups[0].orderCount).toBe(15);
    expect(groups[0].packageCount).toBe(28);
    expect(groups[0].orders.map((o) => o.id)).toEqual(['o1', 'o2']);
  });

  it('names the andenes a comuna is split across', () => {
    const a = anden({ id: 'a1', name: 'Sur', comunas: [{ id: 'c1', name: 'Maipú', order_count: 1, package_count: 1, orders: [] }] });
    const b = anden({ id: 'a2', name: 'Poniente', comunas: [{ id: 'c1', name: 'Maipú', order_count: 1, package_count: 1, orders: [] }] });
    expect(buildGroups([a, b], 'comuna')[0].subtitle).toBe('Sur · Poniente');
  });

  it('sorts comunas by order count, heaviest first', () => {
    const groups = buildGroups([anden()], 'comuna');
    expect(groups[0].name).toBe('La Florida');
  });

  it('returns nothing for an empty snapshot', () => {
    expect(buildGroups([], 'comuna')).toEqual([]);
    expect(buildGroups([], 'anden')).toEqual([]);
  });
});

describe('summariseOrderSelection', () => {
  const groups = buildGroups(
    [
      anden(),
      anden({
        id: 'a2',
        name: 'Norte',
        order_count: 30,
        package_count: 70,
        order_ids: ['o3'],
        comunas_list: ['Colina'],
        comunas: [{ id: 'c3', name: 'Colina', order_count: 30, package_count: 70, orders: [order({ id: 'o3', order_number: 'ORD-003', package_count: 70 })] }],
      }),
    ],
    'anden',
  );

  it('is empty with nothing selected', () => {
    expect(summariseOrderSelection(groups, new Set())).toEqual({
      groupCount: 0,
      orderCount: 0,
      packageCount: 0,
      comunaCount: 0,
      orderIds: [],
    });
  });

  it('totals only the selected orders', () => {
    const s = summariseOrderSelection(groups, new Set(['o3']));
    expect(s).toEqual({ groupCount: 1, orderCount: 1, packageCount: 70, comunaCount: 1, orderIds: ['o3'] });
  });

  it('counts a group touched by a partial selection within it', () => {
    // o1 lives in group a1 (La Florida/Puente Alto); selecting it alone
    // still counts as one group touched, not zero.
    const s = summariseOrderSelection(groups, new Set(['o1']));
    expect(s.groupCount).toBe(1);
    expect(s.orderCount).toBe(1);
    expect(s.packageCount).toBe(2);
  });

  it('counts distinct comunas across the selection', () => {
    const s = summariseOrderSelection(groups, new Set(['o1', 'o2', 'o3']));
    expect(s.comunaCount).toBe(3);
    expect(s.orderIds).toEqual(['o1', 'o2', 'o3']);
  });

  it('ignores a selected id that is no longer in the list', () => {
    expect(summariseOrderSelection(groups, new Set(['gone'])).orderCount).toBe(0);
  });
});

describe('groupSelectionState', () => {
  const groups = buildGroups([anden()], 'anden');
  const group = groups[0]; // orders: o1, o2

  it('is none when nothing in the group is selected', () => {
    expect(groupSelectionState(group, new Set())).toBe('none');
  });

  it('is some when only part of the group is selected', () => {
    expect(groupSelectionState(group, new Set(['o1']))).toBe('some');
  });

  it('is all when every order in the group is selected', () => {
    expect(groupSelectionState(group, new Set(['o1', 'o2']))).toBe('all');
  });
});

describe('toggleGroupSelection', () => {
  const groups = buildGroups([anden()], 'anden');
  const group = groups[0]; // orders: o1, o2

  it('selects every child order when none or some are selected', () => {
    expect([...toggleGroupSelection(group, new Set())].sort()).toEqual(['o1', 'o2']);
    expect([...toggleGroupSelection(group, new Set(['o1']))].sort()).toEqual(['o1', 'o2']);
  });

  it('clears every child order when all are selected', () => {
    expect([...toggleGroupSelection(group, new Set(['o1', 'o2']))]).toEqual([]);
  });

  it('leaves selections outside the group untouched', () => {
    const next = toggleGroupSelection(group, new Set(['other']));
    expect([...next].sort()).toEqual(['o1', 'o2', 'other']);
  });
});

describe('allOrderIds', () => {
  it('flattens every order id across every group', () => {
    const groups = buildGroups([anden()], 'anden');
    expect(allOrderIds(groups)).toEqual(['o1', 'o2']);
  });
});

describe('sortOrdersByWindow', () => {
  const rows = buildGroups([anden()], 'anden')[0].orders;
  it('sorts ascending by windowStart', () => {
    const [a, b] = [
      { ...rows[0], id: 'x', windowStart: '14:00:00' },
      { ...rows[1], id: 'y', windowStart: '09:00:00' },
    ];
    expect(sortOrdersByWindow([a, b]).map((o) => o.id)).toEqual(['y', 'x']);
  });

  it('pushes orders with no windowStart to the end', () => {
    const [a, b] = [
      { ...rows[0], id: 'no-window', windowStart: null },
      { ...rows[1], id: 'has-window', windowStart: '09:00:00' },
    ];
    expect(sortOrdersByWindow([a, b]).map((o) => o.id)).toEqual(['has-window', 'no-window']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { ...rows[0], id: 'x', windowStart: '14:00:00' },
      { ...rows[1], id: 'y', windowStart: '09:00:00' },
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
});
