import { describe, it, expect } from 'vitest';
import { arrivalTotals, buildArrivals } from './arrivals';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

const NOW = new Date('2026-08-17T12:41:00Z');

function route(over: Partial<IncomingRoute> = {}): IncomingRoute {
  return {
    id: 'r1',
    code: 'R-2481',
    driver_id: 'd1',
    driver_name: 'Marcela Rojas',
    plate: 'ABCD-12',
    in_transit_at: null,
    started_at: null,
    manifest_count: 2,
    expected_packages: 88,
    ...over,
  };
}

describe('buildArrivals', () => {
  it('merges the three lifecycle lists into one sequence', () => {
    const rows = buildArrivals(
      {
        yard: [route({ id: 'a' })],
        transit: [route({ id: 'b' })],
        closed: [route({ id: 'c' })],
      },
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.state)).toEqual(['yard', 'transit', 'closed']);
  });

  it('puts the yard first and the longest wait at the top of it', () => {
    // The truck blocking a bay is the one to deal with, whatever the schedule.
    const rows = buildArrivals(
      {
        yard: [
          route({ id: 'short', in_transit_at: '2026-08-17T12:26:00Z' }),
          route({ id: 'long', in_transit_at: '2026-08-17T12:00:00Z' }),
        ],
        transit: [route({ id: 'driving' })],
        closed: [],
      },
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['long', 'short', 'driving']);
    expect(rows[0].waitingMinutes).toBe(41);
    expect(rows[1].waitingMinutes).toBe(15);
  });

  it('does not call a truck still driving "waiting"', () => {
    const rows = buildArrivals(
      { yard: [], transit: [route({ in_transit_at: '2026-08-17T12:00:00Z' })], closed: [] },
      NOW,
    );
    expect(rows[0].waitingMinutes).toBeNull();
    expect(rows[0].arrivedAtLabel).toBeNull();
  });

  it('survives a yard route with no arrival timestamp', () => {
    const rows = buildArrivals({ yard: [route({ in_transit_at: null })], transit: [], closed: [] }, NOW);
    expect(rows[0].waitingMinutes).toBeNull();
  });

  it('never reports a negative wait for a clock skew', () => {
    const rows = buildArrivals(
      { yard: [route({ in_transit_at: '2026-08-17T13:00:00Z' })], transit: [], closed: [] },
      NOW,
    );
    expect(rows[0].waitingMinutes).toBe(0);
  });
});

describe('arrivalTotals', () => {
  const rows = buildArrivals(
    {
      yard: [route({ id: 'a', expected_packages: 88, in_transit_at: '2026-08-17T12:00:00Z' })],
      transit: [route({ id: 'b', expected_packages: 50 })],
      closed: [route({ id: 'c', expected_packages: 231 })],
    },
    NOW,
  );

  it('counts only open routes as expected today', () => {
    // A closed route has already been counted; including it would double it.
    const t = arrivalTotals(rows);
    expect(t.expectedRoutes).toBe(2);
    expect(t.expectedPackages).toBe(138);
  });

  it('reports the yard backlog and its longest wait', () => {
    const t = arrivalTotals(rows);
    expect(t.yardRoutes).toBe(1);
    expect(t.longestYardWait).toBe(41);
  });

  it('reports closures separately', () => {
    const t = arrivalTotals(rows);
    expect(t.closedRoutes).toBe(1);
    expect(t.closedPackages).toBe(231);
  });

  it('has no longest wait when the yard is empty', () => {
    expect(arrivalTotals(buildArrivals({ yard: [], transit: [], closed: [] }, NOW)).longestYardWait)
      .toBeNull();
  });
});
