import { describe, it, expect } from 'vitest';
import { buildGroups, summariseSelection } from './useUnroutedGroups';
import type { PreRouteAnden } from '@/lib/types';

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
      { id: 'c1', name: 'La Florida', order_count: 40, package_count: 96, orders: [] },
      { id: 'c2', name: 'Puente Alto', order_count: 22, package_count: 52, orders: [] },
    ],
    ...over,
  };
}

describe('buildGroups — por andén', () => {
  it('returns one group per andén, carrying its order ids', () => {
    const groups = buildGroups([anden()], 'anden');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'a1',
      name: 'Sur Oriente',
      orderCount: 62,
      packageCount: 148,
      orderIds: ['o1', 'o2'],
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
  it('flattens andenes into one group per comuna', () => {
    const groups = buildGroups([anden()], 'comuna');
    expect(groups.map((g) => g.name)).toEqual(['La Florida', 'Puente Alto']);
    expect(groups[0].orderCount).toBe(40);
    expect(groups[0].packageCount).toBe(96);
  });

  it('merges a comuna that appears under more than one andén', () => {
    // A comuna can be split across dock zones — that is exactly what
    // has_split_dock_zone_warnings flags — so counts must add up rather than
    // the second occurrence overwriting the first.
    const a = anden({
      id: 'a1',
      comunas: [{ id: 'c1', name: 'Maipú', order_count: 10, package_count: 20, orders: [] }],
      order_ids: ['o1'],
    });
    const b = anden({
      id: 'a2',
      comunas: [{ id: 'c1', name: 'Maipú', order_count: 5, package_count: 8, orders: [] }],
      order_ids: ['o2'],
    });
    const groups = buildGroups([a, b], 'comuna');
    expect(groups).toHaveLength(1);
    expect(groups[0].orderCount).toBe(15);
    expect(groups[0].packageCount).toBe(28);
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

describe('summariseSelection', () => {
  const groups = buildGroups([anden(), anden({ id: 'a2', name: 'Norte', order_count: 30, package_count: 70, order_ids: ['o3'], comunas_list: ['Colina'], comunas: [{ id: 'c3', name: 'Colina', order_count: 30, package_count: 70, orders: [] }] })], 'anden');

  it('is empty with nothing selected', () => {
    expect(summariseSelection(groups, new Set())).toEqual({
      groupCount: 0,
      orderCount: 0,
      packageCount: 0,
      comunaCount: 0,
      orderIds: [],
    });
  });

  it('totals only the selected groups', () => {
    const s = summariseSelection(groups, new Set(['a2']));
    expect(s).toMatchObject({ groupCount: 1, orderCount: 30, packageCount: 70, comunaCount: 1 });
    expect(s.orderIds).toEqual(['o3']);
  });

  it('counts distinct comunas across the selection', () => {
    const s = summariseSelection(groups, new Set(['a1', 'a2']));
    expect(s.comunaCount).toBe(3);
    expect(s.orderIds).toEqual(['o1', 'o2', 'o3']);
  });

  it('ignores a selected id that is no longer in the list', () => {
    // The snapshot refetches every 30s; a group can vanish while selected.
    expect(summariseSelection(groups, new Set(['gone'])).orderCount).toBe(0);
  });
});
