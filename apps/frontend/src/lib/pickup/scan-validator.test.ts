import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateScan } from './scan-validator';

let queryResponses: Record<string, unknown[]>;

function createChain(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  // Real postgrest-js query builders are thenable at every step, not only
  // after `.limit()` — scan-validator.ts's order-packages lookup (step 3)
  // never calls `.limit()`. Without this, `await` on the chain object
  // resolves to the chain itself (not `{ data, error }`), which none of the
  // tests exercised until the M-3 order-number-batch test below reached it.
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data, error: null });
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      const data = queryResponses[table] ?? [];
      return createChain(data);
    },
  }),
}));

describe('validateScan', () => {
  beforeEach(() => {
    queryResponses = {};
  });

  it('returns duplicate when barcode already verified for manifest', async () => {
    queryResponses = { pickup_scans: [{ id: 'existing-scan' }] };

    const result = await validateScan('CTN001', 'manifest-1', 'op-1', 'LOAD-1');
    expect(result.scanResult).toBe('duplicate');
    expect(result.packageId).toBeNull();
    expect(result.packageIds).toEqual([]);
  });

  it('returns not_found when barcode matches nothing', async () => {
    queryResponses = {
      pickup_scans: [],
      packages: [],
      orders: [],
    };

    const result = await validateScan('UNKNOWN', 'manifest-1', 'op-1', 'LOAD-1');
    expect(result.scanResult).toBe('not_found');
    expect(result.packageId).toBeNull();
    expect(result.packageIds).toEqual([]);
  });

  it('returns duplicate when package_id already verified (different barcode)', async () => {
    queryResponses['packages'] = [{ id: 'pkg-1', label: 'CTN001', order_id: 'order-1' }];
    queryResponses['orders'] = [{ id: 'order-1' }];

    let pickupScansCallCount = 0;
    Object.defineProperty(queryResponses, 'pickup_scans', {
      configurable: true,
      get() {
        pickupScansCallCount++;
        // First call: barcode duplicate check → no duplicate
        // Second call: IN query for verified package_ids → pkg-1 already verified
        return pickupScansCallCount === 1 ? [] : [{ package_id: 'pkg-1' }];
      },
    });

    const result = await validateScan('CTN001', 'manifest-1', 'op-1', 'LOAD-1');
    expect(result.scanResult).toBe('duplicate');
  });

  // M-3 (spec-81 fase 3, round 2 of review): the migration's unique index
  // over (operator_id, client_operation_id, package_id) NULLS NOT DISTINCT
  // makes a same-statement batch of rows sharing one client_operation_id
  // AND package_id IS NULL auto-collide (throws 23505 on its own first
  // insert, not on retry) — see
  // spec81_fase3_pickup_scans_idempotency.test.sql TEST 14. That is only
  // safe because usePickupScans.ts only batches (N rows, one INSERT) when
  // validateScan returns packageIds.length > 1, and this order-number path
  // is the ONLY branch that ever returns more than one id — every id in it
  // comes straight from packages.id (NOT NULL primary key), never from a
  // not_found/duplicate result (which always returns packageIds: []). This
  // test freezes that: an order-number match with several unverified
  // packages returns only real, non-null ids — if this ever regressed to
  // include a null, the batch insert would auto-collide with itself on its
  // first attempt in production.
  it('order-number batch scan returns only non-null package ids (freezes the M-3 premise)', async () => {
    queryResponses['packages'] = []; // no direct label match
    queryResponses['orders'] = [{ id: 'order-1' }]; // order-number match

    let ordersCallCount = 0;
    Object.defineProperty(queryResponses, 'orders', {
      configurable: true,
      get() {
        ordersCallCount++;
        // First call: verify packageMatch's order belongs to this load — n/a
        // (no packages match). Second call: order-number lookup.
        return [{ id: 'order-1' }];
      },
    });

    let packagesCallCount = 0;
    Object.defineProperty(queryResponses, 'packages', {
      configurable: true,
      get() {
        packagesCallCount++;
        // First call: direct label match — none. Second call: all packages
        // of order-1.
        return packagesCallCount === 1
          ? []
          : [
              { id: 'pkg-a', label: 'CTN-A' },
              { id: 'pkg-b', label: 'CTN-B' },
            ];
      },
    });

    queryResponses['pickup_scans'] = []; // nothing verified yet for either package

    const result = await validateScan('ORD-1', 'manifest-1', 'op-1', 'LOAD-1');
    expect(result.scanResult).toBe('verified');
    expect(result.packageIds.length).toBeGreaterThan(1);
    expect(result.packageIds.every((id) => id !== null && id !== undefined)).toBe(true);
  });
});
