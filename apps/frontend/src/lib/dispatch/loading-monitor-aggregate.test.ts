import { describe, it, expect } from 'vitest';
import { aggregatePackagesByRoute, aggregateCrew } from './loading-monitor-aggregate';

describe('aggregatePackagesByRoute', () => {
  const dispatches = [
    { id: 'd1', route_id: 'r1', order_id: 'o1' },
    { id: 'd2', route_id: 'r1', order_id: 'o2' },
    { id: 'd3', route_id: 'r2', order_id: 'o3' },
  ];

  it('counts a dispatchable-but-unloaded package toward total, not loaded', () => {
    const packages = [
      { order_id: 'o1', loaded_at: null, loaded_by: null, status: 'sectorizado' },
    ];
    const agg = aggregatePackagesByRoute(dispatches, packages);
    expect(agg.get('r1')).toEqual({ total: 1, loaded: 0, firstScanAtIso: null, lastScanAtIso: null });
  });

  it('counts a loaded package toward both total and loaded, and records scan timestamps', () => {
    const packages = [
      { order_id: 'o1', loaded_at: '2026-09-03T11:50:00Z', loaded_by: 'u1', status: 'en_carga' },
      { order_id: 'o2', loaded_at: '2026-09-03T11:58:00Z', loaded_by: 'u2', status: 'en_carga' },
    ];
    const agg = aggregatePackagesByRoute(dispatches, packages);
    expect(agg.get('r1')).toEqual({
      total: 2,
      loaded: 2,
      firstScanAtIso: '2026-09-03T11:50:00Z',
      lastScanAtIso: '2026-09-03T11:58:00Z',
    });
  });

  it('excludes a package that is neither loaded nor dispatchable (dañado, retenido, entregado…)', () => {
    const packages = [
      { order_id: 'o1', loaded_at: null, loaded_by: null, status: 'dañado' },
    ];
    const agg = aggregatePackagesByRoute(dispatches, packages);
    expect(agg.has('r1')).toBe(false);
  });

  it('ignores a package whose order has no dispatch on any open route', () => {
    const packages = [
      { order_id: 'o-orphan', loaded_at: '2026-09-03T11:50:00Z', loaded_by: 'u1', status: 'en_carga' },
    ];
    const agg = aggregatePackagesByRoute(dispatches, packages);
    expect(agg.size).toBe(0);
  });

  it('keeps separate routes separate', () => {
    const packages = [
      { order_id: 'o1', loaded_at: '2026-09-03T11:50:00Z', loaded_by: 'u1', status: 'en_carga' },
      { order_id: 'o3', loaded_at: '2026-09-03T11:40:00Z', loaded_by: 'u1', status: 'en_carga' },
    ];
    const agg = aggregatePackagesByRoute(dispatches, packages);
    expect(agg.get('r1')?.loaded).toBe(1);
    expect(agg.get('r2')?.loaded).toBe(1);
  });
});

describe('aggregateCrew', () => {
  const dispatches = [
    { id: 'd1', route_id: 'r1', order_id: 'o1' },
    { id: 'd2', route_id: 'r1', order_id: 'o2' },
    { id: 'd3', route_id: 'r2', order_id: 'o3' },
  ];

  it('ignores packages with no loaded_by (never scanned, or a backfilled/inferred row with no actor)', () => {
    const packages = [
      { order_id: 'o1', loaded_at: '2026-09-03T11:50:00Z', loaded_by: null, status: 'en_carga' },
    ];
    expect(aggregateCrew(dispatches, packages)).toEqual([]);
  });

  it('counts scans per user and keeps their latest scan time', () => {
    const packages = [
      { order_id: 'o1', loaded_at: '2026-09-03T11:50:00Z', loaded_by: 'u1', status: 'en_carga' },
      { order_id: 'o2', loaded_at: '2026-09-03T11:58:00Z', loaded_by: 'u1', status: 'en_carga' },
    ];
    const crew = aggregateCrew(dispatches, packages);
    expect(crew).toEqual([
      { userId: 'u1', routeId: 'r1', scanCount: 2, lastScanAtIso: '2026-09-03T11:58:00Z' },
    ]);
  });

  it('attributes a user to the route of their MOST RECENT scan, not their first', () => {
    const packages = [
      { order_id: 'o1', loaded_at: '2026-09-03T11:50:00Z', loaded_by: 'u1', status: 'en_carga' }, // r1, earlier
      { order_id: 'o3', loaded_at: '2026-09-03T11:58:00Z', loaded_by: 'u1', status: 'en_carga' }, // r2, later
    ];
    const crew = aggregateCrew(dispatches, packages);
    expect(crew).toEqual([
      { userId: 'u1', routeId: 'r2', scanCount: 2, lastScanAtIso: '2026-09-03T11:58:00Z' },
    ]);
  });

  it('keeps distinct users separate', () => {
    const packages = [
      { order_id: 'o1', loaded_at: '2026-09-03T11:50:00Z', loaded_by: 'u1', status: 'en_carga' },
      { order_id: 'o3', loaded_at: '2026-09-03T11:40:00Z', loaded_by: 'u2', status: 'en_carga' },
    ];
    const crew = aggregateCrew(dispatches, packages);
    expect(crew.map((c) => c.userId).sort()).toEqual(['u1', 'u2']);
  });
});
