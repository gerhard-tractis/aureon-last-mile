import { describe, it, expect } from 'vitest';
import { loadedPackageIds, LOADED_ON_TRUCK_STATUSES } from '@/lib/dispatch/dispatch-local-completion';
import type { DispatchRow, PackageRow } from '@/lib/dispatch/dispatch-dt-payload';

/**
 * spec-79 review F5: direct unit coverage for the pure function, pinning
 * every boundary case named in the review — retenido, dañado, deleted,
 * backfilled-loaded_at (load_inferred), and a genuine scan. Before this file
 * existed, every one of these cases only got exercised through a 6-deep
 * mockReturnValueOnce chain in route-dispatch.test.ts, which detects a
 * regression here by accident of mock ordering rather than by an assertion
 * naming the behaviour.
 */

function pkg(overrides: Partial<PackageRow> & { id: string }): PackageRow {
  return {
    label: 'CTN-1',
    sku_items: [],
    status: null,
    deleted_at: null,
    loaded_at: null,
    load_inferred: false,
    ...overrides,
  };
}

function dispatchWithPackages(packages: PackageRow[]): DispatchRow {
  return {
    id: 'd1',
    order_id: 'o1',
    orders: {
      order_number: '4821',
      customer_name: 'Mario',
      delivery_address: 'Av Principal 1',
      customer_phone: null,
      packages,
    },
  };
}

describe('loadedPackageIds', () => {
  it('includes a genuinely scanned box: en_carga, loaded_at set, load_inferred false', () => {
    const d = dispatchWithPackages([
      pkg({ id: 'p-scanned', status: 'en_carga', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false }),
    ]);
    expect(loadedPackageIds([d])).toEqual(['p-scanned']);
  });

  it('includes a genuinely scanned box already moved to listo_para_despacho by /seal', () => {
    const d = dispatchWithPackages([
      pkg({ id: 'p-sealed', status: 'listo_para_despacho', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false }),
    ]);
    expect(loadedPackageIds([d])).toEqual(['p-sealed']);
  });

  it('excludes a retenido package even when it carries a genuine loaded_at', () => {
    // spec-79 F2's own scenario: a box scanned, then held back in
    // consolidation before dispatch. status must gate this, not loaded_at
    // alone.
    const d = dispatchWithPackages([
      pkg({ id: 'p-held', status: 'retenido', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false }),
    ]);
    expect(loadedPackageIds([d])).toEqual([]);
  });

  it('excludes a dañado package even when it carries a genuine loaded_at', () => {
    const d = dispatchWithPackages([
      pkg({ id: 'p-damaged', status: 'dañado', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false }),
    ]);
    expect(loadedPackageIds([d])).toEqual([]);
  });

  it('excludes a soft-deleted package regardless of status or loaded_at', () => {
    const d = dispatchWithPackages([
      pkg({
        id: 'p-deleted',
        status: 'en_carga',
        loaded_at: '2026-09-04T10:00:00Z',
        load_inferred: false,
        deleted_at: '2026-09-03T00:00:00Z',
      }),
    ]);
    expect(loadedPackageIds([d])).toEqual([]);
  });

  it('excludes an en_carga/listo_para_despacho package never scanned (loaded_at null)', () => {
    const d = dispatchWithPackages([
      pkg({ id: 'p-never-scanned', status: 'asignado', loaded_at: null, load_inferred: false }),
      pkg({ id: 'p-dock-ready', status: 'listo_para_despacho', loaded_at: null, load_inferred: false }),
    ]);
    expect(loadedPackageIds([d])).toEqual([]);
  });

  /**
   * spec-79 review F1 (CRITICAL): the core boundary case. A backfilled row
   * (spec-74's migration, 20260901000001) sets loaded_at on EVERY live
   * package of an already-staged/adopted order, including one that never
   * left the dock — load_inferred stays true precisely to mark that this is
   * not evidence of a real scan. Without the load_inferred check this box
   * would be written to en_ruta despite never having been loaded.
   */
  it('excludes a backfilled (load_inferred) package even with status listo_para_despacho and loaded_at set', () => {
    const d = dispatchWithPackages([
      pkg({
        id: 'p-inferred',
        status: 'listo_para_despacho',
        loaded_at: '2026-09-01T00:00:00Z',
        load_inferred: true,
      }),
    ]);
    expect(loadedPackageIds([d])).toEqual([]);
  });

  it('a split order: only the genuinely scanned box qualifies, the untouched sibling does not', () => {
    const d = dispatchWithPackages([
      pkg({ id: 'p-loaded', status: 'en_carga', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false }),
      pkg({ id: 'p-on-dock', status: 'asignado', loaded_at: null, load_inferred: false }),
    ]);
    expect(loadedPackageIds([d])).toEqual(['p-loaded']);
  });

  it('flattens across multiple dispatches', () => {
    const d1 = dispatchWithPackages([
      pkg({ id: 'p-1', status: 'en_carga', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false }),
    ]);
    const d2 = dispatchWithPackages([
      pkg({ id: 'p-2', status: 'listo_para_despacho', loaded_at: '2026-09-04T10:05:00Z', load_inferred: false }),
    ]);
    expect(loadedPackageIds([d1, d2])).toEqual(['p-1', 'p-2']);
  });

  it('handles an orders array (PostgREST embed shape) the same as a single object', () => {
    const d: DispatchRow = {
      id: 'd1',
      order_id: 'o1',
      orders: [{
        order_number: '4821',
        customer_name: 'Mario',
        delivery_address: 'Av Principal 1',
        customer_phone: null,
        packages: [pkg({ id: 'p-1', status: 'en_carga', loaded_at: '2026-09-04T10:00:00Z', load_inferred: false })],
      }],
    };
    expect(loadedPackageIds([d])).toEqual(['p-1']);
  });

  it('LOADED_ON_TRUCK_STATUSES is exactly en_carga and listo_para_despacho', () => {
    expect(LOADED_ON_TRUCK_STATUSES).toEqual(['en_carga', 'listo_para_despacho']);
  });
});
