import { describe, it, expect } from 'vitest';
import { isGenuinelyLoadedPackage, isGenuinelyLoadedByFact, LOADED_ON_TRUCK_STATUSES } from '@/lib/dispatch/dispatch-load-state';
import { buildItems } from '@/lib/dispatch/dispatch-dt-payload';
import type { PackageRow } from '@/lib/dispatch/dispatch-dt-payload';

function pkg(overrides: Partial<PackageRow> & { id: string }): PackageRow {
  return {
    label: 'CTN-1',
    sku_items: [],
    status: 'en_carga',
    deleted_at: null,
    loaded_at: '2026-09-04T10:00:00Z',
    load_inferred: false,
    loaded_route_id: 'route-a',
    ...overrides,
  };
}

/**
 * spec-79 BLOCKER — the five-step scenario from the report, written failing
 * FIRST (isGenuinelyLoadedPackage did not accept a routeId at all before
 * this fix; every one of these would have compiled against the old
 * signature only by dropping the second argument, and then passed
 * incorrectly for box2/box3 because nothing distinguished "loaded onto A"
 * from "loaded onto B").
 *
 * 1. Order O, 3 bultos. Route A partially_staged: box1 genuinely loaded,
 *    box2/box3 not.
 * 2. Force-seal A -> force_split. box1 -> listo_para_despacho (genuinely
 *    loaded, on route A). box2/box3 stay sectorizado, loaded_at IS NULL.
 * 3. box2 is planned onto route B and scanned there -> en_carga,
 *    loaded_at set, load_inferred false, loaded_route_id = B.
 * 4. Route A dispatches (status loaded). Its manifest/en_ruta write must
 *    see ONLY box1 — box2 belongs to a DIFFERENT route's load fact.
 * 5. Route B dispatches. Its manifest/en_ruta write must see box2 (once it
 *    is itself genuinely loaded onto B), never box1 (which belongs to A).
 */
describe('spec-79 BLOCKER: a box loaded on route B must not appear on route A\'s manifest', () => {
  const box1 = pkg({ id: 'box-1', label: 'CTN-1', status: 'listo_para_despacho', loaded_route_id: 'route-a' });
  const box2 = pkg({ id: 'box-2', label: 'CTN-2', status: 'en_carga', loaded_route_id: 'route-b' });
  const box3 = pkg({ id: 'box-3', label: 'CTN-3', status: 'sectorizado', loaded_at: null, loaded_route_id: null });

  it('isGenuinelyLoadedPackage: box1 counts for route A, not for route B', () => {
    expect(isGenuinelyLoadedPackage(box1, 'route-a')).toBe(true);
    expect(isGenuinelyLoadedPackage(box1, 'route-b')).toBe(false);
  });

  it('isGenuinelyLoadedPackage: box2 counts for route B, not for route A', () => {
    expect(isGenuinelyLoadedPackage(box2, 'route-b')).toBe(true);
    expect(isGenuinelyLoadedPackage(box2, 'route-a')).toBe(false);
  });

  it('isGenuinelyLoadedPackage: box3 (never scanned, released to dock) counts for neither route', () => {
    expect(isGenuinelyLoadedPackage(box3, 'route-a')).toBe(false);
    expect(isGenuinelyLoadedPackage(box3, 'route-b')).toBe(false);
  });

  it("route A's manifest (buildItems) lists box1 only, never box2 or box3", () => {
    const items = buildItems([box1, box2, box3], 'route-a');
    expect(items.map((i) => i.code)).toEqual(['CTN-1']);
    // Distinguish from a false pass: box1 is the only package genuinely
    // loaded onto route-a in this fixture, so a single-item result alone
    // does not prove box2 was excluded FOR THE RIGHT REASON — check labels.
    expect(items).toHaveLength(1);
  });

  it("route B's manifest (buildItems) lists box2 only, never box1 or box3", () => {
    const items = buildItems([box1, box2, box3], 'route-b');
    expect(items.map((i) => i.code)).toEqual(['CTN-2']);
    expect(items).toHaveLength(1);
  });

  it('isGenuinelyLoadedByFact (the retry/already-dispatched count) is route-scoped too', () => {
    const enRutaOnA = pkg({ id: 'box-1', status: 'en_ruta', loaded_route_id: 'route-a' });
    expect(isGenuinelyLoadedByFact(enRutaOnA, 'route-a')).toBe(true);
    expect(isGenuinelyLoadedByFact(enRutaOnA, 'route-b')).toBe(false);
  });
});

describe('isGenuinelyLoadedPackage — boundary cases unrelated to route scoping (unchanged from spec-79 F1)', () => {
  it('requires a genuine scan (load_inferred false) regardless of route match', () => {
    const inferred = pkg({ id: 'p1', status: 'listo_para_despacho', load_inferred: true, loaded_route_id: 'route-a' });
    expect(isGenuinelyLoadedPackage(inferred, 'route-a')).toBe(false);
  });

  it('requires a dispatchable status regardless of route match', () => {
    const retained = pkg({ id: 'p1', status: 'retenido', loaded_route_id: 'route-a' });
    expect(isGenuinelyLoadedPackage(retained, 'route-a')).toBe(false);
  });

  it('excludes a soft-deleted package regardless of route match', () => {
    const deleted = pkg({ id: 'p1', deleted_at: '2026-01-01T00:00:00Z', loaded_route_id: 'route-a' });
    expect(isGenuinelyLoadedPackage(deleted, 'route-a')).toBe(false);
  });

  it('LOADED_ON_TRUCK_STATUSES is unchanged by this fix', () => {
    expect(LOADED_ON_TRUCK_STATUSES).toEqual(['en_carga', 'listo_para_despacho']);
  });
});
