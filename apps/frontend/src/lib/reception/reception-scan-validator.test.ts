import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateReceptionScan } from './reception-scan-validator';

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;

/**
 * Filtering fake: `.eq` / `.is` / `.in` accumulate predicates and `.limit`
 * applies them. Unlike a fixed-payload stub this makes the `operator_id`
 * predicate load-bearing — dropping it from the membership join changes the
 * rows the fake returns, so the cross-operator collision test actually fails.
 */
function createChain(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    filters.push((r) => r[col] === val);
    return chain;
  };
  chain.is = (col: string, val: unknown) => {
    filters.push((r) => (r[col] ?? null) === val);
    return chain;
  };
  chain.in = (col: string, vals: unknown[]) => {
    filters.push((r) => vals.includes(r[col]));
    return chain;
  };
  chain.limit = (n: number) =>
    Promise.resolve({
      data: rows.filter((r) => filters.every((f) => f(r))).slice(0, n),
      error: null,
    });
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => createChain(tables[table] ?? []),
  }),
}));

const OP = 'op-1';
const ROUTE = 'route-1';

function base(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    reception_scans: [],
    packages: [
      {
        id: 'pkg-1',
        label: 'CTN001',
        status: 'verificado',
        order_id: 'order-1',
        operator_id: OP,
        deleted_at: null,
      },
    ],
    orders: [
      { id: 'order-1', external_load_id: 'CARGA-001', operator_id: OP, deleted_at: null },
    ],
    manifests: [
      {
        id: 'man-1',
        external_load_id: 'CARGA-001',
        operator_id: OP,
        pickup_route_id: ROUTE,
        deleted_at: null,
      },
    ],
    pickup_scans: [
      {
        id: 'ps-1',
        package_id: 'pkg-1',
        operator_id: OP,
        scan_result: 'verified',
        deleted_at: null,
      },
    ],
    ...overrides,
  } as Record<string, Row[]>;
}

function scan(barcode = 'CTN001', routeId = ROUTE) {
  return validateReceptionScan({
    barcode,
    receptionId: 'rec-1',
    routeId,
    operatorId: OP,
  });
}

describe('validateReceptionScan — 7-row discriminator', () => {
  beforeEach(() => {
    tables = base();
  });

  it('row 1: label matches no package for this operator → not_found', async () => {
    tables = base({ packages: [] });
    const result = await scan('UNKNOWN');
    expect(result.scanResult).toBe('not_found');
    expect(result.packageId).toBeNull();
    expect(result.message).toBe('Paquete no pertenece a esta carga');
  });

  it('row 1: a package belonging to another operator is not visible', async () => {
    tables = base({
      packages: [
        {
          id: 'pkg-x',
          label: 'CTN001',
          status: 'verificado',
          order_id: 'order-1',
          operator_id: 'op-2',
          deleted_at: null,
        },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('not_found');
  });

  it('row 2: package already scanned in this batch → duplicate', async () => {
    tables = base({
      reception_scans: [
        {
          id: 'existing',
          reception_id: 'rec-1',
          barcode: 'CTN001',
          scan_result: 'received',
          deleted_at: null,
        },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('duplicate');
    expect(result.packageId).toBeNull();
    expect(result.message).toBeUndefined();
  });

  it('row 2: duplicate is still evaluated before row 1 for an unknown barcode', async () => {
    tables = base({
      packages: [],
      reception_scans: [
        {
          id: 'existing',
          reception_id: 'rec-1',
          barcode: 'UNKNOWN',
          scan_result: 'received',
          deleted_at: null,
        },
      ],
    });
    const result = await scan('UNKNOWN');
    expect(result.scanResult).toBe('duplicate');
  });

  it('row 3: orders.external_load_id IS NULL → not_found "Paquete sin carga asociada"', async () => {
    tables = base({
      orders: [
        { id: 'order-1', external_load_id: null, operator_id: OP, deleted_at: null },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('not_found');
    expect(result.message).toBe('Paquete sin carga asociada');
  });

  it('row 3: no order row at all → not_found "Paquete sin carga asociada"', async () => {
    tables = base({ orders: [] });
    const result = await scan();
    expect(result.scanResult).toBe('not_found');
    expect(result.message).toBe('Paquete sin carga asociada');
  });

  it('row 4: status en_bodega → not_found "Paquete ya fue recibido en bodega"', async () => {
    tables = base({
      packages: [
        { id: 'pkg-1', label: 'CTN001', status: 'en_bodega', order_id: 'order-1', operator_id: OP, deleted_at: null },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('not_found');
    expect(result.message).toBe('Paquete ya fue recibido en bodega');
  });

  it('row 4: rank-0 statuses (cancelado, devuelto, dañado, extraviado) are still rejected', async () => {
    for (const status of ['cancelado', 'devuelto', 'dañado', 'extraviado', 'listo_para_despacho']) {
      tables = base({
        packages: [
          { id: 'pkg-1', label: 'CTN001', status, order_id: 'order-1', operator_id: OP, deleted_at: null },
        ],
      });
      const result = await scan();
      expect(result.scanResult, status).toBe('not_found');
      expect(result.message, status).toBe('Paquete ya fue recibido en bodega');
    }
  });

  it('row 5: package on a manifest belonging to another route → route_mismatch', async () => {
    tables = base({
      manifests: [
        {
          id: 'man-1',
          external_load_id: 'CARGA-001',
          operator_id: OP,
          pickup_route_id: 'route-OTHER',
          deleted_at: null,
        },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('route_mismatch');
    expect(result.packageId).toBe('pkg-1');
    expect(result.message).toBe('Paquete no pertenece a este camión');
  });

  it('row 5: the membership join is operator-scoped — a cross-operator external_load_id collision is not membership', async () => {
    // Another tenant happens to use the same external_load_id and HAS put it
    // on this route id. Without the operator_id predicate this resolves as
    // membership and the package is accepted.
    tables = base({
      manifests: [
        {
          id: 'man-other-op',
          external_load_id: 'CARGA-001',
          operator_id: 'op-2',
          pickup_route_id: ROUTE,
          deleted_at: null,
        },
        {
          id: 'man-1',
          external_load_id: 'CARGA-001',
          operator_id: OP,
          pickup_route_id: 'route-OTHER',
          deleted_at: null,
        },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('route_mismatch');
  });

  it('row 6: on this route with a verified pickup scan → received (expected)', async () => {
    const result = await scan();
    expect(result.scanResult).toBe('received');
    expect(result.packageId).toBe('pkg-1');
    expect(result.packageLabel).toBe('CTN001');
    expect(result.unexpected).toBe(false);
  });

  it('row 7: on this route without a verified pickup scan → received, flagged unexpected', async () => {
    tables = base({ pickup_scans: [] });
    const result = await scan();
    expect(result.scanResult).toBe('received');
    expect(result.packageId).toBe('pkg-1');
    expect(result.unexpected).toBe(true);
  });

  it('row 7: a non-verified pickup scan does not count as expected', async () => {
    tables = base({
      pickup_scans: [
        { id: 'ps-1', package_id: 'pkg-1', operator_id: OP, scan_result: 'not_found', deleted_at: null },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('received');
    expect(result.unexpected).toBe(true);
  });

  it('row 7 replaces the old blanket rejection: an "ingresado" package on this route is received', async () => {
    tables = base({
      packages: [
        { id: 'pkg-1', label: 'CTN001', status: 'ingresado', order_id: 'order-1', operator_id: OP, deleted_at: null },
      ],
      pickup_scans: [],
    });
    const result = await scan();
    expect(result.scanResult).toBe('received');
    expect(result.unexpected).toBe(true);
  });

  it('a manifest with no pickup_route_id is not membership of this route', async () => {
    tables = base({
      manifests: [
        {
          id: 'man-1',
          external_load_id: 'CARGA-001',
          operator_id: OP,
          pickup_route_id: null,
          deleted_at: null,
        },
      ],
    });
    const result = await scan();
    expect(result.scanResult).toBe('route_mismatch');
  });
});
