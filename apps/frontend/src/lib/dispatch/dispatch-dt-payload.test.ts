import { describe, it, expect } from 'vitest';
import {
  buildItems,
  buildDtDispatches,
  findMissingOrderNumbers,
  findDispatchesWithNoLoadedItems,
  type DispatchRow,
  type PackageRow,
} from '@/lib/dispatch/dispatch-dt-payload';

/** spec-79 review F5: neither this file nor dispatch-local-completion.ts had
 * a unit test before this pass. */

function pkg(overrides: Partial<PackageRow> & { id: string }): PackageRow {
  return {
    label: 'CTN-1',
    sku_items: [],
    status: 'en_carga',
    deleted_at: null,
    // spec-79 review F5: buildItems now shares isGenuinelyLoadedPackage with
    // loadedPackageIds, so a default fixture must represent a genuine scan
    // (loaded_at set, load_inferred false) — the same default
    // dispatch-local-completion.test.ts uses.
    loaded_at: '2026-09-04T10:00:00Z',
    load_inferred: false,
    ...overrides,
  };
}

describe('buildItems', () => {
  it('excludes soft-deleted and label-less packages', () => {
    const items = buildItems([
      pkg({ id: 'p1', label: 'CTN-1' }),
      pkg({ id: 'p2', label: null }),
      pkg({ id: 'p3', label: 'CTN-3', deleted_at: '2026-01-01T00:00:00Z' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe('CTN-1');
  });

  it('folds multiple SKU lines into one item, joining names/descriptions and summing quantity', () => {
    const items = buildItems([
      pkg({
        id: 'p1',
        label: 'CTN-1',
        sku_items: [
          { sku: 'SKU-A', description: 'Widget A', quantity: 2 },
          { sku: 'SKU-B', description: 'Widget B', quantity: 3 },
        ],
      }),
    ]);
    expect(items).toEqual([
      { code: 'CTN-1', name: 'SKU-A, SKU-B', description: 'Widget A, Widget B', quantity: '5' },
    ]);
  });

  it('a package with no SKU data still produces an item with quantity 1', () => {
    const items = buildItems([pkg({ id: 'p1', label: 'CTN-1', sku_items: [] })]);
    expect(items).toEqual([{ code: 'CTN-1', quantity: '1' }]);
  });

  it('handles null/undefined input', () => {
    expect(buildItems(null)).toEqual([]);
    expect(buildItems(undefined)).toEqual([]);
  });

  /**
   * spec-79 review F5: the DT guide must not list a box our own database
   * refuses to mark en_ruta. Before this, a retenido sibling (held back in
   * consolidation, which does not block the seal) still made it into the
   * guide sent to DispatchTrack.
   */
  it('excludes a retenido sibling even though it is not soft-deleted and carries a label', () => {
    const items = buildItems([
      pkg({ id: 'p1', label: 'CTN-1', status: 'en_carga' }),
      pkg({ id: 'p2', label: 'CTN-2', status: 'retenido' }),
    ]);
    expect(items.map((i) => i.code)).toEqual(['CTN-1']);
  });

  it('excludes a package never genuinely scanned (loaded_at null)', () => {
    const items = buildItems([
      pkg({ id: 'p1', label: 'CTN-1', status: 'listo_para_despacho', loaded_at: null }),
    ]);
    expect(items).toEqual([]);
  });

  it('excludes a backfilled (load_inferred) package — not evidence of a real scan', () => {
    const items = buildItems([
      pkg({ id: 'p1', label: 'CTN-1', status: 'listo_para_despacho', load_inferred: true }),
    ]);
    expect(items).toEqual([]);
  });
});

describe('findMissingOrderNumbers', () => {
  function dispatchWithOrderNumber(orderNumber: string | null | undefined): DispatchRow {
    return {
      id: 'd1',
      order_id: 'o1',
      orders: {
        order_number: orderNumber,
        customer_name: null,
        delivery_address: null,
        customer_phone: null,
        packages: [],
      },
    };
  }

  it('flags a dispatch whose order has no order_number', () => {
    const missing = findMissingOrderNumbers([dispatchWithOrderNumber(null), dispatchWithOrderNumber('4821')]);
    expect(missing).toHaveLength(1);
  });

  it('flags a blank/whitespace-only order_number', () => {
    const missing = findMissingOrderNumbers([dispatchWithOrderNumber('   ')]);
    expect(missing).toHaveLength(1);
  });

  it('does not flag a dispatch with a real order_number', () => {
    expect(findMissingOrderNumbers([dispatchWithOrderNumber('4821')])).toEqual([]);
  });
});

/**
 * spec-79 B-1 (blocker): a dispatch whose order carries zero
 * genuinely-loaded packages must be flagged BEFORE the route goes to
 * DispatchTrack — sending it means DT gets a stop with no contents while the
 * boxes are still on the andén, and the previous handler reported this as
 * `200 {ok:true}`. `createDTRoute` omits an empty `items` key entirely
 * (`dispatchtrack-api.ts`'s `if (d.items?.length) dispatch.items = d.items`),
 * so there was no signal downstream to catch this — it has to be caught
 * here, on the same input `buildItems` already filters.
 */
describe('findDispatchesWithNoLoadedItems', () => {
  function dispatchWithPackages(id: string, packages: PackageRow[]): DispatchRow {
    return {
      id,
      order_id: `o-${id}`,
      orders: {
        order_number: `${id}-000`,
        customer_name: 'Mario',
        delivery_address: 'Av Principal 1',
        customer_phone: null,
        packages,
      },
    };
  }

  it('flags a dispatch whose every package is legacy load_inferred (pre-spec-74, never re-scanned)', () => {
    const d = dispatchWithPackages('d1', [
      pkg({ id: 'p1', label: 'CTN-1', status: 'listo_para_despacho', load_inferred: true }),
    ]);
    expect(findDispatchesWithNoLoadedItems([d])).toEqual([d]);
  });

  it('flags a dispatch whose every package is retenido after staging', () => {
    const d = dispatchWithPackages('d1', [
      pkg({ id: 'p1', label: 'CTN-1', status: 'retenido' }),
    ]);
    expect(findDispatchesWithNoLoadedItems([d])).toEqual([d]);
  });

  it('flags a dispatch whose every package was soft-deleted after sealing', () => {
    const d = dispatchWithPackages('d1', [
      pkg({ id: 'p1', label: 'CTN-1', status: 'en_carga', deleted_at: '2026-09-05T00:00:00Z' }),
    ]);
    expect(findDispatchesWithNoLoadedItems([d])).toEqual([d]);
  });

  it('flags a dispatch with no packages at all', () => {
    const d = dispatchWithPackages('d1', []);
    expect(findDispatchesWithNoLoadedItems([d])).toEqual([d]);
  });

  it('does not flag a dispatch that carries at least one genuinely-loaded package', () => {
    const d = dispatchWithPackages('d1', [pkg({ id: 'p1', label: 'CTN-1' })]);
    expect(findDispatchesWithNoLoadedItems([d])).toEqual([]);
  });

  it('flags only the empty stop when other stops are fine (per-stop, not whole-route)', () => {
    const fine = dispatchWithPackages('d1', [pkg({ id: 'p1', label: 'CTN-1' })]);
    const empty = dispatchWithPackages('d2', [
      pkg({ id: 'p2', label: 'CTN-2', status: 'retenido' }),
    ]);
    expect(findDispatchesWithNoLoadedItems([fine, empty])).toEqual([empty]);
  });
});

describe('buildDtDispatches', () => {
  function dispatchRow(orderNumber: string): DispatchRow {
    return {
      id: 'd1',
      order_id: 'o1',
      orders: {
        order_number: orderNumber,
        customer_name: 'Mario',
        delivery_address: 'Av Principal 1',
        customer_phone: '555-1234',
        packages: [pkg({ id: 'p1', label: 'CTN-1' })],
      },
    };
  }

  it('sends a purely numeric order_number as a number', () => {
    const [dt] = buildDtDispatches([dispatchRow('4821')]);
    expect(dt.identifier).toBe(4821);
  });

  it('sends an alphanumeric order_number as a string, never mangled by parseInt', () => {
    const [dt] = buildDtDispatches([dispatchRow('AB-4821')]);
    expect(dt.identifier).toBe('AB-4821');
  });

  it('sends an order_number with no digits as the string it is, not null/NaN', () => {
    const [dt] = buildDtDispatches([dispatchRow('SIN-NUMERO')]);
    expect(dt.identifier).toBe('SIN-NUMERO');
  });

  it('carries contact fields from the order, not invented ones', () => {
    const [dt] = buildDtDispatches([dispatchRow('4821')]);
    expect(dt.contact_name).toBe('Mario');
    expect(dt.contact_address).toBe('Av Principal 1');
    expect(dt.contact_phone).toBe('555-1234');
    expect(dt.contact_email).toBeNull();
  });
});
