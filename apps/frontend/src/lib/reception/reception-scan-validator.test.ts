import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateReceptionScan } from './reception-scan-validator';

let queryResponses: Record<string, unknown[]>;

function createChain(data: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: data.length ? null : { code: 'PGRST116' } });
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

describe('validateReceptionScan', () => {
  beforeEach(() => {
    queryResponses = {};
  });

  it('returns "received" for a verificado package in the manifest', async () => {
    queryResponses = {
      reception_scans: [],
      packages: [{ id: 'pkg-1', label: 'CTN001', status: 'verificado', order_id: 'order-1' }],
    };

    const result = await validateReceptionScan({
      barcode: 'CTN001',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
    });

    expect(result.scanResult).toBe('received');
    expect(result.packageId).toBe('pkg-1');
    expect(result.packageLabel).toBe('CTN001');
  });

  it('returns "duplicate" when package already scanned in this reception', async () => {
    queryResponses = {
      reception_scans: [{ id: 'existing-scan' }],
    };

    const result = await validateReceptionScan({
      barcode: 'CTN001',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
    });

    expect(result.scanResult).toBe('duplicate');
    expect(result.packageId).toBeNull();
    expect(result.message).toBeUndefined();
  });

  it('returns "not_found" when barcode not in manifest packages', async () => {
    queryResponses = {
      reception_scans: [],
      packages: [],
    };

    const result = await validateReceptionScan({
      barcode: 'UNKNOWN',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
    });

    expect(result.scanResult).toBe('not_found');
    expect(result.packageId).toBeNull();
    expect(result.message).toBe('Paquete no pertenece a esta carga');
  });

  it('returns "not_found" with message for package not verificado (ingresado)', async () => {
    queryResponses = {
      reception_scans: [],
      packages: [{ id: 'pkg-2', label: 'CTN002', status: 'ingresado', order_id: 'order-1' }],
    };

    const result = await validateReceptionScan({
      barcode: 'CTN002',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
    });

    expect(result.scanResult).toBe('not_found');
    expect(result.message).toBe('Paquete no verificado en retiro');
  });

  it('returns "not_found" with message for package already en_bodega', async () => {
    queryResponses = {
      reception_scans: [],
      packages: [{ id: 'pkg-3', label: 'CTN003', status: 'en_bodega', order_id: 'order-1' }],
    };

    const result = await validateReceptionScan({
      barcode: 'CTN003',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
    });

    expect(result.scanResult).toBe('not_found');
    expect(result.message).toBe('Paquete ya fue recibido en bodega');
  });

  it('returns "not_found" with message for package in later status (en_ruta)', async () => {
    queryResponses = {
      reception_scans: [],
      packages: [{ id: 'pkg-4', label: 'CTN004', status: 'en_ruta', order_id: 'order-1' }],
    };

    const result = await validateReceptionScan({
      barcode: 'CTN004',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
    });

    expect(result.scanResult).toBe('not_found');
    expect(result.message).toBe('Paquete ya fue recibido en bodega');
  });
});
