import { describe, it, expect } from 'vitest';
import { buildLoadableQueue } from './crew-queue';
import type { RouteCard } from './crew-board';

function makeRoute(overrides: Partial<RouteCard>): RouteCard {
  return {
    id: 'r1', code: 'R1', status: 'draft', chip: 'borrador', comuna: null, otherComunaCount: 0,
    packagesTotal: 0, packagesLoaded: 0, percent: 0, loadPositionLabel: null, driverName: null,
    vehicleExternalId: null, loadedByOtherName: null, ...overrides,
  };
}

describe('buildLoadableQueue', () => {
  it('excludes the current task and routes blocked by another crew (spec-76 review I5)', () => {
    const cards: RouteCard[] = [
      makeRoute({ id: 'mine', chip: 'tu_carga' }),
      makeRoute({ id: 'draft', chip: 'borrador' }),
      makeRoute({ id: 'ready', chip: 'lista', status: 'loaded' }),
      makeRoute({ id: 'blocked', chip: 'otra_cuadrilla' }),
    ];
    expect(buildLoadableQueue(cards, 'mine').map((c) => c.id)).toEqual(['draft', 'ready']);
  });

  it('returns everything openable when there is no current task to exclude', () => {
    const cards: RouteCard[] = [makeRoute({ id: 'a', chip: 'borrador' }), makeRoute({ id: 'b', chip: 'otra_cuadrilla' })];
    expect(buildLoadableQueue(cards, null).map((c) => c.id)).toEqual(['a']);
  });
});
