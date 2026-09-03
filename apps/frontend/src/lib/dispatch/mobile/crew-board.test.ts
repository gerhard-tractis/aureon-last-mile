import { describe, it, expect } from 'vitest';
import {
  aggregateBoxesByRoute,
  countAndenPendingByRoute,
  summarizeComunaByRoute,
  findLoaderByRoute,
  routeChip,
  buildRouteCards,
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
  it('counts loaded and dispatchable-but-unloaded packages per route (includes en_bodega — packagesTotal is "boxes on the route")', () => {
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

describe('countAndenPendingByRoute — spec-76 review I4', () => {
  it('excludes en_bodega — a box that has not reached the andén does not count as "en el andén"', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: null, loaded_by: null, status: 'en_bodega' },
      { order_id: 'order-2', loaded_at: null, loaded_by: null, status: 'asignado' },
    ];
    const pending = countAndenPendingByRoute(dispatches, packages);
    expect(pending.get('route-1')).toBe(1); // only the `asignado` one
  });

  it('counts sectorizado/asignado/listo_para_despacho, not-yet-loaded', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: null, loaded_by: null, status: 'sectorizado' },
      { order_id: 'order-2', loaded_at: null, loaded_by: null, status: 'listo_para_despacho' },
      { order_id: 'order-3', loaded_at: null, loaded_by: null, status: 'asignado' },
    ];
    const pending = countAndenPendingByRoute(dispatches, packages);
    expect(pending.get('route-1')).toBe(2);
    expect(pending.get('route-2')).toBe(1);
  });

  it('excludes a package already loaded', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'asignado' },
    ];
    expect(countAndenPendingByRoute(dispatches, packages).get('route-1')).toBeUndefined();
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

  it('spec-76 review C2 — a crew member moving route A -> route B keeps A its own loader', () => {
    // u1 scans on route-1 (via order-1) first, then later moves to route-2
    // (via order-3). The old implementation tracked only each user's single
    // globally-latest scan, so u1's move to route-2 evicted route-1 from the
    // map entirely — route-1 lost its loader and silently reopened.
    const packages: CrewPackageRow[] = [
      { order_id: 'order-1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'order-3', loaded_at: '2026-09-03T11:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    ];
    const loaders = findLoaderByRoute(dispatches, packages, names);
    expect(loaders.get('route-1')).toMatchObject({ userId: 'u1' });
    expect(loaders.get('route-2')).toMatchObject({ userId: 'u1' });
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

  it('is borrador when the route has not started loading at all', () => {
    expect(routeChip('draft', undefined, 'u1')).toBe('borrador');
  });

  it('spec-76 review C2 — loading with NO resolvable loader is otra_cuadrilla, not borrador', () => {
    // Someone moved the route out of draft (status is loading) but no scan
    // has landed yet — still blocked, not fully openable by a second crew.
    expect(routeChip('loading', undefined, 'u1')).toBe('otra_cuadrilla');
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

  it('spec-76 review D1 — sorts cards TU CARGA, BORRADOR, LISTA, then blocked-by-another-crew', () => {
    const mixedRoutes: CrewRouteRow[] = [
      { id: 'r-lista', status: 'loaded', loadPositionLabel: null, vehicleExternalId: null, driverName: null, createdAtIso: '2026-09-03T06:00:00Z' },
      { id: 'r-otra', status: 'loading', loadPositionLabel: null, vehicleExternalId: null, driverName: null, createdAtIso: '2026-09-03T07:00:00Z' },
      { id: 'r-borrador', status: 'draft', loadPositionLabel: null, vehicleExternalId: null, driverName: null, createdAtIso: '2026-09-03T08:00:00Z' },
      { id: 'r-tuya', status: 'loading', loadPositionLabel: null, vehicleExternalId: null, driverName: null, createdAtIso: '2026-09-03T09:00:00Z' },
    ];
    const mixedDispatches: CrewDispatchLinkRow[] = [
      { route_id: 'r-otra', order_id: 'o-otra' },
      { route_id: 'r-tuya', order_id: 'o-tuya' },
    ];
    const mixedPackages: CrewPackageRow[] = [
      { order_id: 'o-otra', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'other-user', status: 'en_bodega' },
      { order_id: 'o-tuya', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    ];
    const cards = buildRouteCards(mixedRoutes, mixedDispatches, mixedPackages, new Map(), names, 'u1');
    expect(cards.map((c) => c.id)).toEqual(['r-tuya', 'r-borrador', 'r-lista', 'r-otra']);
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
