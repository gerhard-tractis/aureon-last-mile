import { describe, it, expect } from 'vitest';
import {
  buildEnRutaRoute,
  computeEnRutaMetrics,
  compareEnRutaIncidence,
  sortEnRutaRoutes,
  formatLastEventLabel,
  groupDispatchesByRoute,
  subtractDaysISO,
  type RawDispatchRow,
  type RawRouteRow,
  type EnRutaRoute,
} from './en-ruta';

function route(overrides: Partial<RawRouteRow> = {}): RawRouteRow {
  return {
    id: 'r1',
    external_route_id: 'RUT-2026-0001',
    driver_name: 'Mario González',
    vehicle_id: 'v1',
    status: 'in_transit',
    route_date: '2026-09-04',
    ...overrides,
  };
}

function dispatch(overrides: Partial<RawDispatchRow> = {}): RawDispatchRow {
  return {
    route_id: 'r1',
    order_id: 'o1',
    status: 'pending',
    completed_at: null,
    estimated_at: null,
    updated_at: '2026-09-04T12:00:00Z',
    ...overrides,
  };
}

function enRutaRoute(overrides: Partial<EnRutaRoute> = {}): EnRutaRoute {
  return {
    id: 'r1',
    externalRouteId: 'RUT-1',
    driverName: 'X',
    truckIdentifier: 'ZALDUENDO',
    status: 'in_transit',
    routeDate: '2026-09-04',
    comunas: [],
    paradasTotal: 10,
    paradasCompletadas: 5,
    fallidas: 0,
    lastEventAt: null,
    ...overrides,
  };
}

describe('groupDispatchesByRoute', () => {
  it('groups by route_id and drops dispatches with no route_id', () => {
    const grouped = groupDispatchesByRoute([
      dispatch({ route_id: 'r1', order_id: 'o1' }),
      dispatch({ route_id: 'r2', order_id: 'o2' }),
      dispatch({ route_id: 'r1', order_id: 'o3' }),
      dispatch({ route_id: null, order_id: 'o4' }),
    ]);
    expect(grouped.get('r1')).toHaveLength(2);
    expect(grouped.get('r2')).toHaveLength(1);
    expect(Array.from(grouped.keys())).toEqual(['r1', 'r2']);
  });
});

describe('buildEnRutaRoute', () => {
  it('counts paradasTotal/paradasCompletadas/fallidas from exactly the dispatches it is given', () => {
    const routeDispatches = [
      dispatch({ status: 'failed' }),
      dispatch({ status: 'delivered' }),
      dispatch({ status: 'pending' }),
    ];
    const result = buildEnRutaRoute(route(), routeDispatches, new Map(), new Map());
    expect(result.paradasTotal).toBe(3); // the local dispatch count, never routes.planned_stops
    expect(result.paradasCompletadas).toBe(2); // failed + delivered, not pending
    expect(result.fallidas).toBe(1);
  });

  it('numerator and denominator can never drift apart — both come from the same array', () => {
    const routeDispatches = [dispatch({ status: 'delivered' }), dispatch({ status: 'delivered' })];
    const result = buildEnRutaRoute(route(), routeDispatches, new Map(), new Map());
    expect(result.paradasCompletadas).toBeLessThanOrEqual(result.paradasTotal);
  });

  it('carries routeDate through from the raw row', () => {
    const result = buildEnRutaRoute(route({ route_date: '2026-09-01' }), [], new Map(), new Map());
    expect(result.routeDate).toBe('2026-09-01');
  });

  it('derives distinct sorted comunas from the order lookup, real column only', () => {
    const routeDispatches = [
      dispatch({ order_id: 'o1' }),
      dispatch({ order_id: 'o2' }),
      dispatch({ order_id: 'o3' }), // no comuna entry — must not crash or fabricate
    ];
    const orderComunas = new Map([
      ['o1', 'Puente Alto'],
      ['o2', 'La Florida'],
    ]);
    const result = buildEnRutaRoute(route(), routeDispatches, orderComunas, new Map());
    expect(result.comunas).toEqual(['La Florida', 'Puente Alto']);
  });

  it('resolves truckIdentifier from fleet_vehicles via vehicle_id, not routes.truck_identifier', () => {
    const vehicles = new Map([['v1', 'ZALDUENDO']]);
    const result = buildEnRutaRoute(route({ vehicle_id: 'v1' }), [], new Map(), vehicles);
    expect(result.truckIdentifier).toBe('ZALDUENDO');
  });

  it('is null truckIdentifier when the route has no vehicle_id yet', () => {
    const result = buildEnRutaRoute(route({ vehicle_id: null }), [], new Map(), new Map());
    expect(result.truckIdentifier).toBeNull();
  });

  it('lastEventAt is the max updated_at across this route\'s dispatches', () => {
    const routeDispatches = [
      dispatch({ updated_at: '2026-09-04T10:00:00Z' }),
      dispatch({ updated_at: '2026-09-04T12:30:00Z' }),
      dispatch({ updated_at: '2026-09-04T09:00:00Z' }),
    ];
    const result = buildEnRutaRoute(route(), routeDispatches, new Map(), new Map());
    expect(result.lastEventAt).toBe('2026-09-04T12:30:00Z');
  });

  it('lastEventAt is null and paradasTotal is 0 when the route has no dispatches', () => {
    const result = buildEnRutaRoute(route(), [], new Map(), new Map());
    expect(result.lastEventAt).toBeNull();
    expect(result.paradasTotal).toBe(0);
  });
});

describe('computeEnRutaMetrics', () => {
  it('counts entregadas/pendientes/fallidas by dispatch status', () => {
    const dispatches = [
      dispatch({ status: 'delivered' }),
      dispatch({ status: 'delivered' }),
      dispatch({ status: 'pending' }),
      dispatch({ status: 'failed' }),
    ];
    const metrics = computeEnRutaMetrics(dispatches);
    expect(metrics.entregadas).toBe(2);
    expect(metrics.pendientes).toBe(1);
    expect(metrics.fallidas).toBe(1);
  });

  it('otifPct is null when no dispatch has both a resolution and a promised time', () => {
    const dispatches = [
      dispatch({ status: 'delivered', completed_at: null, estimated_at: null }),
      dispatch({ status: 'pending' }),
    ];
    expect(computeEnRutaMetrics(dispatches).otifPct).toBeNull();
  });

  it('otifPct grades on-time-in-full only over gradable dispatches', () => {
    const dispatches = [
      // on-time, in-full
      dispatch({ status: 'delivered', completed_at: '2026-09-04T10:00:00Z', estimated_at: '2026-09-04T10:30:00Z' }),
      // late delivery — not on time
      dispatch({ status: 'delivered', completed_at: '2026-09-04T11:00:00Z', estimated_at: '2026-09-04T10:30:00Z' }),
      // partial — resolved but not "in full"
      dispatch({ status: 'partial', completed_at: '2026-09-04T09:00:00Z', estimated_at: '2026-09-04T10:00:00Z' }),
      // pending — not resolved, excluded from denominator entirely
      dispatch({ status: 'pending' }),
    ];
    const metrics = computeEnRutaMetrics(dispatches);
    // gradable = 3 (delivered x2 + partial), on-time-in-full = 1
    expect(metrics.otifPct).toBeCloseTo(33.3, 1);
  });
});

describe('compareEnRutaIncidence / sortEnRutaRoutes', () => {
  it('sorts more fallidas first', () => {
    const a = enRutaRoute({ id: 'a', fallidas: 1 });
    const b = enRutaRoute({ id: 'b', fallidas: 5 });
    expect(sortEnRutaRoutes([a, b]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('breaks a fallidas tie by staler (older) lastEventAt first', () => {
    const fresh = enRutaRoute({ id: 'fresh', fallidas: 2, lastEventAt: '2026-09-04T12:00:00Z' });
    const stale = enRutaRoute({ id: 'stale', fallidas: 2, lastEventAt: '2026-09-04T10:00:00Z' });
    expect(sortEnRutaRoutes([fresh, stale]).map((r) => r.id)).toEqual(['stale', 'fresh']);
  });

  it('a route with no events at all outranks one with a stale-but-present event, at equal fallidas', () => {
    const noEvents = enRutaRoute({ id: 'none', fallidas: 0, lastEventAt: null });
    const withEvent = enRutaRoute({ id: 'has', fallidas: 0, lastEventAt: '2026-09-04T10:00:00Z' });
    expect(sortEnRutaRoutes([withEvent, noEvents]).map((r) => r.id)).toEqual(['none', 'has']);
  });

  it('5 fallidas + 41-minutes-stale beats 0 fallidas + fresh — the example from the spec', () => {
    const worst = enRutaRoute({ id: 'worst', fallidas: 5, lastEventAt: '2026-09-04T11:19:00Z' });
    const fine = enRutaRoute({ id: 'fine', fallidas: 0, lastEventAt: '2026-09-04T12:00:00Z' });
    expect(sortEnRutaRoutes([fine, worst]).map((r) => r.id)).toEqual(['worst', 'fine']);
  });

  it('two routes that both have no event ever are equal — comparator never returns NaN', () => {
    const a = enRutaRoute({ id: 'a', fallidas: 0, lastEventAt: null });
    const b = enRutaRoute({ id: 'b', fallidas: 0, lastEventAt: null });
    expect(compareEnRutaIncidence(a, b)).toBe(0);
    expect(compareEnRutaIncidence(b, a)).toBe(0);
    // Array.prototype.sort is stable — the pair's relative order survives.
    expect(sortEnRutaRoutes([a, b]).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('formatLastEventLabel', () => {
  it('renders "sin eventos" when there is no last event', () => {
    expect(formatLastEventLabel(null, Date.now())).toBe('sin eventos');
  });

  it('renders "hace N s" under a minute', () => {
    const now = new Date('2026-09-04T12:00:08Z').getTime();
    expect(formatLastEventLabel('2026-09-04T12:00:00Z', now)).toBe('hace 8 s');
  });

  it('renders "hace N min" from a real timestamp', () => {
    const now = new Date('2026-09-04T12:41:00Z').getTime();
    const label = formatLastEventLabel('2026-09-04T12:00:00Z', now);
    expect(label).toBe('hace 41 min');
  });

  it('rolls over to hours past 60 minutes — a full-shift monitor, not just a stall card', () => {
    const now = new Date('2026-09-04T12:40:00Z').getTime();
    expect(formatLastEventLabel('2026-09-04T07:00:00Z', now)).toBe('hace 5 h 40 min');
  });

  it('drops the "0 min" tail on an exact hour', () => {
    const now = new Date('2026-09-04T12:00:00Z').getTime();
    expect(formatLastEventLabel('2026-09-04T07:00:00Z', now)).toBe('hace 5 h');
  });
});

describe('subtractDaysISO', () => {
  it('subtracts whole civil days', () => {
    expect(subtractDaysISO('2026-09-04', 7)).toBe('2026-08-28');
  });

  it('crosses a month boundary', () => {
    expect(subtractDaysISO('2026-09-03', 5)).toBe('2026-08-29');
  });

  it('is timezone-independent — pure calendar arithmetic, not "now"', () => {
    expect(subtractDaysISO('2026-01-01', 1)).toBe('2025-12-31');
  });
});
