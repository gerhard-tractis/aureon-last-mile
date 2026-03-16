import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateScan } from './scan-validator';

let queryResponses: Record<string, unknown[]>;

function createChain(data: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
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
});
