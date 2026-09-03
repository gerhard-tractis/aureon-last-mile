import { describe, it, expect } from 'vitest';
import {
  aggregateBoxesByRoute,
  summarizeComunaByRoute,
  findLoaderByRoute,
  routeChip,
  buildRouteCards,
  computeTodayScanStats,
  filterRouteCards,
  routeTabCounts,
  routeCode,
  type CrewDispatchLinkRow,
  type CrewPackageRow,
  type CrewRouteRow,
} from './crew-board';

const dispatches: CrewDispatchLinkRow[] = [
  { route_id: 'route-1', order_id: 'order-1' },
  { route_id: 'route-1', order_id: 'order-2' },
  { route_id: 'route-2', order_id: 'order-3' },
];

describe('routeCode', () => {
  it('takes the first 8 chars of the route id, uppercased', () => {
    expect(routeCode('abcdef1234567890')).toBe('ABCDEF12');
  });
});

describe('aggregateBoxesByRoute', () => {
  it('counts loaded and dispatchable-but-unloaded packages per route', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'order-1', loaded_at: null, loaded_by: null, status: 'asignado' },
      { order_id: 'order-2', loaded_at: null, loaded_by: null, status: 'entregado' }, // not dispatchable, never loaded -> excluded
    ];
    const agg = aggregateBoxesByRoute(dispatches, packages);
    expect(agg.get('route-1')).toEqual({ total: 2, loaded: 1 });
    expect(agg.get('route-2')).toBeUndefined();
  });
});

describe('summarizeComunaByRoute', () => {
  it('picks the dominant comuna and counts the rest', () => {
    const comunaByOrder = new Map([
      ['order-1', 'Santiago'],
      ['order-2', 'Santiago'],
      ['order-3', 'Providencia'],
    ]);
    const summary = summarizeComunaByRoute(dispatches, comunaByOrder);
    expect(summary.get('route-1')).toEqual({ comuna: 'Santiago', otherCount: 0 });
    expect(summary.get('route-2')).toEqual({ comuna: 'Providencia', otherCount: 0 });
  });

  it('reports otherCount when a route spans more than one comuna', () => {
    const comunaByOrder = new Map([
      ['order-1', 'Santiago'],
      ['order-2', 'Ñuñoa'],
    ]);
    const summary = summarizeComunaByRoute(dispatches, comunaByOrder);
    expect(summary.get('route-1')?.otherCount).toBe(1);
  });
});

describe('findLoaderByRoute', () => {
  const names = new Map([['u1', 'Javiera P.'], ['u2', 'Marco S.']]);

  it('attributes a route to whoever scanned there most recently', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'order-3', loaded_at: '2026-09-03T11:00:00Z', loaded_by: 'u2', status: 'en_bodega' },
    ];
    const loaders = findLoaderByRoute(dispatches, packages, names);
    expect(loaders.get('route-1')).toMatchObject({ userId: 'u1', fullName: 'Javiera P.' });
    expect(loaders.get('route-2')).toMatchObject({ userId: 'u2', fullName: 'Marco S.' });
  });

  it('ignores packages with no loaded_at/loaded_by', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: null, loaded_by: null, status: 'asignado' },
    ];
    expect(findLoaderByRoute(dispatches, packages, names).size).toBe(0);
  });
});

describe('routeChip', () => {
  const loader = { userId: 'u1', fullName: 'Javiera P.', lastScanAtIso: '2026-09-03T10:00:00Z' };

  it('is lista once the route is loaded, regardless of loader', () => {
    expect(routeChip('loaded', loader, 'u1')).toBe('lista');
  });

  it('is tu_carga when the current user is the active loader on a loading route', () => {
    expect(routeChip('loading', loader, 'u1')).toBe('tu_carga');
  });

  it('is otra_cuadrilla when someone else is loading it', () => {
    expect(routeChip('loading', loader, 'u2')).toBe('otra_cuadrilla');
  });

  it('is borrador when nobody has scanned on it yet', () => {
    expect(routeChip('draft', undefined, 'u1')).toBe('borrador');
    expect(routeChip('loading', undefined, 'u1')).toBe('borrador');
  });
});

describe('buildRouteCards', () => {
  const routes: CrewRouteRow[] = [
    { id: 'route-1', status: 'loading', loadPositionLabel: 'Muelle 4', vehicleExternalId: null, driverName: null, createdAtIso: '2026-09-03T08:00:00Z' },
    { id: 'route-2', status: 'draft', loadPositionLabel: null, vehicleExternalId: null, driverName: null, createdAtIso: '2026-09-03T08:00:00Z' },
  ];
  const packages: CrewPackageRow[] = [
    { order_id: 'order-1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    { order_id: 'order-2', loaded_at: null, loaded_by: null, status: 'asignado' },
  ];
  const comunaByOrder = new Map([['order-1', 'Santiago'], ['order-2', 'Santiago']]);
  const names = new Map([['u1', 'Javiera P.']]);

  it('assembles one card per route with chip, comuna, progress and loader', () => {
    const cards = buildRouteCards(routes, dispatches, packages, comunaByOrder, names, 'u1');
    const card1 = cards.find((c) => c.id === 'route-1')!;
    expect(card1.chip).toBe('tu_carga');
    expect(card1.comuna).toBe('Santiago');
    expect(card1.packagesTotal).toBe(2);
    expect(card1.packagesLoaded).toBe(1);
    expect(card1.percent).toBe(50);
    expect(card1.loadPositionLabel).toBe('Muelle 4');
    expect(card1.loadedByOtherName).toBeNull();

    const card2 = cards.find((c) => c.id === 'route-2')!;
    expect(card2.chip).toBe('borrador');
    expect(card2.packagesTotal).toBe(0);
    expect(card2.percent).toBe(0);
  });

  it('names the other crew member on a route being loaded by someone else', () => {
    const cards = buildRouteCards(routes, dispatches, packages, comunaByOrder, names, 'someone-else');
    const card1 = cards.find((c) => c.id === 'route-1')!;
    expect(card1.chip).toBe('otra_cuadrilla');
    expect(card1.loadedByOtherName).toBe('Javiera P.');
  });
});

describe('computeTodayScanStats', () => {
  const civilDateOf = (iso: string) => iso.slice(0, 10);

  it('counts only this user\'s scans on the given civil date', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'o1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'o2', loaded_at: '2026-09-03T10:30:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'o3', loaded_at: '2026-09-02T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' }, // yesterday
      { order_id: 'o4', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u2', status: 'en_bodega' }, // someone else
    ];
    const stats = computeTodayScanStats(packages, 'u1', '2026-09-03', civilDateOf);
    expect(stats.scannedToday).toBe(2);
  });

  it('returns a null rate with fewer than two scans or a too-small time spread', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'o1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    ];
    expect(computeTodayScanStats(packages, 'u1', '2026-09-03', civilDateOf).ratePerHour).toBeNull();
  });

  it('derives packages/hour once there is a real spread', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'o1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'o2', loaded_at: '2026-09-03T11:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    ];
    const stats = computeTodayScanStats(packages, 'u1', '2026-09-03', civilDateOf);
    expect(stats.ratePerHour).toBe(2);
  });

  it('returns zero/null for a user with no scans today, never undefined', () => {
    expect(computeTodayScanStats([], 'u1', '2026-09-03', civilDateOf)).toEqual({ scannedToday: 0, ratePerHour: null });
    expect(computeTodayScanStats([], null, '2026-09-03', civilDateOf)).toEqual({ scannedToday: 0, ratePerHour: null });
  });
});

describe('filterRouteCards / routeTabCounts', () => {
  const cards = [
    { id: '1', chip: 'tu_carga', status: 'loading' },
    { id: '2', chip: 'borrador', status: 'draft' },
    { id: '3', chip: 'lista', status: 'loaded' },
    { id: '4', chip: 'otra_cuadrilla', status: 'loading' },
  ] as unknown as ReturnType<typeof buildRouteCards>;

  it('filters mias to tu_carga only', () => {
    expect(filterRouteCards(cards, 'mias').map((c) => c.id)).toEqual(['1']);
  });

  it('filters listas to loaded status', () => {
    expect(filterRouteCards(cards, 'listas').map((c) => c.id)).toEqual(['3']);
  });

  it('todas returns everything, including a route loaded by another crew', () => {
    expect(filterRouteCards(cards, 'todas')).toHaveLength(4);
  });

  it('counts each tab', () => {
    expect(routeTabCounts(cards)).toEqual({ todas: 4, mias: 1, listas: 1 });
  });
});
