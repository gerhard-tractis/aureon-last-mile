import { describe, it, expect } from 'vitest';
import {
  applyPreRouteFilters,
  collectComunaOptions,
  collectAndenOptions,
  collectClienteOptions,
  parsePreRouteFilterState,
  serializePreRouteFilterState,
  hasActivePreRouteFilters,
  summariseFilteredTotals,
  type PreRouteFilterState,
} from './pre-route-filters';
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
        orders: [order({ id: 'o1', order_number: 'ORD-001', customer_name: 'Ana Soto' })],
      },
      {
        id: 'c2',
        name: 'Puente Alto',
        order_count: 1,
        package_count: 2,
        orders: [
          order({
            id: 'o2',
            order_number: 'ORD-002',
            customer_name: 'Bruno Diaz',
            has_split_dock_zone: true,
          }),
        ],
      },
    ],
    ...over,
  };
}

const EMPTY_FILTERS: PreRouteFilterState = {
  comunaIds: [],
  andenIds: [],
  clientes: [],
  onlyProblems: false,
  search: '',
};

describe('collectComunaOptions / collectAndenOptions / collectClienteOptions', () => {
  const andenes = [anden()];

  it('collects comuna id/name options from every andén', () => {
    expect(collectComunaOptions(andenes)).toEqual([
      { id: 'c1', name: 'La Florida' },
      { id: 'c2', name: 'Puente Alto' },
    ]);
  });

  it('collects andén id/name options', () => {
    expect(collectAndenOptions(andenes)).toEqual([{ id: 'a1', name: 'Sur Oriente' }]);
  });

  it('collects distinct customer names, sorted', () => {
    expect(collectClienteOptions(andenes)).toEqual(['Ana Soto', 'Bruno Diaz']);
  });

  it('de-duplicates a comuna appearing under more than one andén', () => {
    const a2 = anden({ id: 'a2', name: 'Poniente', comunas: [anden().comunas[0]] });
    expect(collectComunaOptions([anden(), a2])).toEqual([
      { id: 'c1', name: 'La Florida' },
      { id: 'c2', name: 'Puente Alto' },
    ]);
  });
});

describe('applyPreRouteFilters', () => {
  it('returns andenes unchanged when no filter is active', () => {
    expect(applyPreRouteFilters([anden()], EMPTY_FILTERS)).toEqual([anden()]);
  });

  it('drops andenes not in andenIds', () => {
    const other = anden({ id: 'a2', name: 'Norte' });
    const result = applyPreRouteFilters([anden(), other], { ...EMPTY_FILTERS, andenIds: ['a2'] });
    expect(result.map((a) => a.id)).toEqual(['a2']);
  });

  it('drops comunas not in comunaIds and recomputes andén totals', () => {
    const result = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, comunaIds: ['c1'] });
    expect(result[0].comunas.map((c) => c.id)).toEqual(['c1']);
    expect(result[0].order_count).toBe(1);
    expect(result[0].package_count).toBe(2);
  });

  it('filters orders by customer name and recomputes comuna totals', () => {
    const result = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, clientes: ['Bruno Diaz'] });
    expect(result[0].comunas.map((c) => c.id)).toEqual(['c2']);
    expect(result[0].order_count).toBe(1);
  });

  it('keeps only has_split_dock_zone orders when onlyProblems is true', () => {
    const result = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, onlyProblems: true });
    expect(result[0].comunas.flatMap((c) => c.orders.map((o) => o.id))).toEqual(['o2']);
  });

  it('matches search against order number', () => {
    const result = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, search: 'ORD-002' });
    expect(result[0].comunas.flatMap((c) => c.orders.map((o) => o.id))).toEqual(['o2']);
  });

  it('matches search against delivery address, case-insensitively', () => {
    const withAddr = anden({
      comunas: [
        {
          id: 'c1',
          name: 'La Florida',
          order_count: 1,
          package_count: 2,
          orders: [order({ id: 'o1', delivery_address: 'Calle Los Alamos 10' })],
        },
      ],
    });
    const result = applyPreRouteFilters([withAddr], { ...EMPTY_FILTERS, search: 'alamos' });
    expect(result[0].comunas[0].orders).toHaveLength(1);
  });

  it('drops a comuna left with zero orders after an order-level filter', () => {
    const result = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, search: 'nonexistent' });
    expect(result).toEqual([]);
  });

  it('drops an andén left with zero comunas after filtering', () => {
    const result = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, comunaIds: ['nope'] });
    expect(result).toEqual([]);
  });

  it('combines multiple filters (AND)', () => {
    const result = applyPreRouteFilters([anden()], {
      ...EMPTY_FILTERS,
      onlyProblems: true,
      clientes: ['Ana Soto'],
    });
    expect(result).toEqual([]);
  });

  it('combines comuna + búsqueda and recomputes counts on both the comuna and the andén, not just presence', () => {
    // c1 has two orders; comunaIds narrows to c1, search narrows further to
    // one of its two orders — the recomputed order_count/package_count on
    // both levels must reflect that single surviving order, not c1's
    // original RPC count (2) or anden()'s original total (2).
    const twoOrderComuna = anden({
      order_count: 2,
      package_count: 5,
      comunas: [
        {
          id: 'c1',
          name: 'La Florida',
          order_count: 2,
          package_count: 5,
          orders: [
            order({ id: 'o1', order_number: 'ORD-001', package_count: 2 }),
            order({ id: 'o2', order_number: 'ORD-002', package_count: 3 }),
          ],
        },
      ],
    });
    const result = applyPreRouteFilters([twoOrderComuna], {
      ...EMPTY_FILTERS,
      comunaIds: ['c1'],
      search: 'ORD-002',
    });
    expect(result).toHaveLength(1);
    expect(result[0].comunas).toHaveLength(1);
    expect(result[0].comunas[0].orders.map((o) => o.id)).toEqual(['o2']);
    expect(result[0].comunas[0].order_count).toBe(1);
    expect(result[0].comunas[0].package_count).toBe(3);
    expect(result[0].order_count).toBe(1);
    expect(result[0].package_count).toBe(3);
  });
});

describe('parsePreRouteFilterState / serializePreRouteFilterState', () => {
  it('parses an empty URLSearchParams to the empty filter state', () => {
    expect(parsePreRouteFilterState(new URLSearchParams())).toEqual(EMPTY_FILTERS);
  });

  it('round-trips comuna/anden/cliente lists and the problems flag through the URL', () => {
    const state: PreRouteFilterState = {
      comunaIds: ['c1', 'c2'],
      andenIds: ['a1'],
      clientes: ['Ana Soto', 'Bruno Diaz'],
      onlyProblems: true,
      search: 'ORD-002',
    };
    const params = serializePreRouteFilterState(state);
    expect(parsePreRouteFilterState(params)).toEqual(state);
  });

  it('parses onlyProblems=1 as true and anything else as false', () => {
    expect(parsePreRouteFilterState(new URLSearchParams('problems=1')).onlyProblems).toBe(true);
    expect(parsePreRouteFilterState(new URLSearchParams('problems=0')).onlyProblems).toBe(false);
  });

  it('does not throw on a malformed percent-escape from a truncated shared URL (C2 regression)', () => {
    // '%' alone is not a valid escape sequence — decodeURIComponent throws
    // on it. A URL clipped mid-paste in chat is exactly how this happens.
    expect(() => parsePreRouteFilterState(new URLSearchParams('comunas=%'))).not.toThrow();
    expect(parsePreRouteFilterState(new URLSearchParams('comunas=%')).comunaIds).toEqual(['%']);
  });
});

describe('hasActivePreRouteFilters', () => {
  it('is false for the empty filter state', () => {
    expect(hasActivePreRouteFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('is true when any single field is set', () => {
    expect(hasActivePreRouteFilters({ ...EMPTY_FILTERS, comunaIds: ['c1'] })).toBe(true);
    expect(hasActivePreRouteFilters({ ...EMPTY_FILTERS, onlyProblems: true })).toBe(true);
    expect(hasActivePreRouteFilters({ ...EMPTY_FILTERS, search: 'ORD' })).toBe(true);
  });

  it('is false for whitespace-only search', () => {
    expect(hasActivePreRouteFilters({ ...EMPTY_FILTERS, search: '   ' })).toBe(false);
  });
});

describe('summariseFilteredTotals', () => {
  it('sums orders/packages and counts andenes across the filtered tree', () => {
    expect(summariseFilteredTotals([anden()])).toEqual({
      order_count: 2,
      package_count: 4,
      anden_count: 1,
      split_dock_zone_order_count: 1, // o2 has_split_dock_zone: true
    });
  });

  it('returns all zeros for an empty tree', () => {
    expect(summariseFilteredTotals([])).toEqual({
      order_count: 0,
      package_count: 0,
      anden_count: 0,
      split_dock_zone_order_count: 0,
    });
  });

  it('reflects a narrowed tree, not the original snapshot totals', () => {
    const narrowed = applyPreRouteFilters([anden()], { ...EMPTY_FILTERS, comunaIds: ['c1'] });
    expect(summariseFilteredTotals(narrowed)).toEqual({
      order_count: 1,
      package_count: 2,
      anden_count: 1,
      split_dock_zone_order_count: 0,
    });
  });
});
