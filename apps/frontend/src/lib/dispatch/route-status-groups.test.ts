import { describe, it, expect } from 'vitest';
import {
  OPEN_ROUTE_STATUSES,
  ON_ROAD_ROUTE_STATUSES,
  FINISHED_ROUTE_STATUSES,
  ACTIVE_ROUTE_STATUSES,
  type RouteStatus,
} from './types';

/**
 * Every value of route_status_enum, written out by hand.
 *
 * Deliberately not derived from the groups under test — a partition cannot be
 * checked against itself. When a migration adds a status, this list is the one
 * place that has to change, and the tests below then say exactly which group
 * forgot about it.
 */
const ALL_STATUSES: RouteStatus[] = [
  'draft', 'planned', 'loading', 'loaded',
  'dispatched', 'in_transit', 'in_progress',
  'completed', 'cancelled',
];

describe('route status tab groups', () => {
  /**
   * The regression this exists for: spec-70 phase 1 remapped live DispatchTrack
   * routes to `dispatched`, and because no tab listed that status, every one of
   * them disappeared from Despacho without an error anywhere.
   */
  it('assigns every status to exactly one tab', () => {
    const homes = ALL_STATUSES.map((status) => ({
      status,
      groups: [
        OPEN_ROUTE_STATUSES.includes(status as never) && 'open',
        ON_ROAD_ROUTE_STATUSES.includes(status as never) && 'on_road',
        FINISHED_ROUTE_STATUSES.includes(status as never) && 'finished',
      ].filter(Boolean),
    }));

    expect(homes.filter((h) => h.groups.length === 0)).toEqual([]);
    expect(homes.filter((h) => h.groups.length > 1)).toEqual([]);
  });

  /**
   * A route still owns its orders right up to the moment it finishes, so the
   * already-routed guards must cover open and on-road alike.
   */
  it('treats every open and on-road status as owning its orders', () => {
    for (const status of [...OPEN_ROUTE_STATUSES, ...ON_ROAD_ROUTE_STATUSES]) {
      expect(ACTIVE_ROUTE_STATUSES).toContain(status);
    }
  });

  /** spec-43: a finished route must not block the order from going out again. */
  it('never treats a finished status as active', () => {
    for (const status of FINISHED_ROUTE_STATUSES) {
      expect(ACTIVE_ROUTE_STATUSES).not.toContain(status);
    }
  });
});
