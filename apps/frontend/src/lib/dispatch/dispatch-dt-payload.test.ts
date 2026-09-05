import { describe, it, expect } from 'vitest';
import {
  buildItems,
  buildDtDispatches,
  findMissingOrderNumbers,
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
    loaded_at: null,
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
