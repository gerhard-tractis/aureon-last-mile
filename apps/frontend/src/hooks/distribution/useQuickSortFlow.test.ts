import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useQuickSortFlow } from './useQuickSortFlow';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

const LC_ID = 'comuna-las-condes';

const zones: DockZone[] = [
  {
    id: 'zone-1', name: 'Andén 1', code: 'DOCK-001',
    is_consolidation: false, is_active: true,
    comunas: [{ id: LC_ID, nombre: 'Las Condes' }],
  },
  {
    id: 'consol', name: 'Consolidación', code: 'CONSOL',
    is_consolidation: true, is_active: true,
    comunas: [],
  },
];

const mockLimit = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/hooks/distribution/useDockBatches', () => ({
  useCreateDockBatch: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'batch-1' }) })),
  useCloseDockBatch: vi.fn(() => ({ mutate: vi.fn() })),
}));

const mockScanMutateAsync = vi
  .fn()
  .mockResolvedValue({ scanResult: 'accepted', packageId: 'pkg-1', packageLabel: 'PKG-001' });

vi.mock('@/hooks/distribution/useDockScans', () => ({
  useDockScanMutation: vi.fn(() => ({
    mutateAsync: mockScanMutateAsync,
    isPending: false,
  })),
}));

const mockUpdateBatchZone = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/distribution/batch-zone', () => ({
  updateBatchDockZone: (...args: unknown[]) => mockUpdateBatchZone(...args),
}));

const mockRecordException = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/distribution/quicksort-exception', () => ({
  recordQuickSortException: (...args: unknown[]) => mockRecordException(...args),
}));

/** packages select chain (package lookup, and the sibling count-only select) */
function packagesChain(packageResult: { data: unknown; error: unknown }, siblingCount = 0) {
  const lookupIs = vi.fn().mockResolvedValue(packageResult);
  const lookupChain = { eq: mockEq, is: lookupIs, limit: mockLimit };
  mockLimit.mockResolvedValue(packageResult);
  // First call chain: .eq().eq().is().limit() -> package lookup
  // Second call chain: .eq().eq().eq().neq().is() -> sibling count (head:true)
  const siblingIs = vi.fn().mockResolvedValue({ count: siblingCount, error: null });
  const siblingChain = { eq: mockEq, neq: mockNeq, is: siblingIs };
  mockNeq.mockReturnValue(siblingChain);
  return { lookupChain, siblingChain };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScanMutateAsync.mockResolvedValue({
    scanResult: 'accepted',
    packageId: 'pkg-1',
    packageLabel: 'PKG-001',
  });
  mockUpdateBatchZone.mockResolvedValue({ error: null });
  mockInsert.mockResolvedValue({ error: null });
  mockRecordException.mockResolvedValue(undefined);

  mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs, neq: mockNeq });
  mockIs.mockReturnValue({ limit: mockLimit, eq: mockEq });
  mockNeq.mockReturnValue({ is: vi.fn().mockResolvedValue({ count: 0, error: null }) });

  // Default: package found with matching order, no siblings pending
  mockLimit.mockResolvedValue({
    data: [{
      id: 'pkg-1',
      label: 'PKG-001',
      status: 'en_bodega',
      order_id: 'ord-1',
      orders: {
        order_number: 'ORD-1',
        comuna_id: LC_ID,
        delivery_date: '2026-03-18',
        chile_comunas: { nombre: 'Las Condes' },
      },
    }],
    error: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides: Partial<{ zones: DockZone[] }> = {}) {
  return renderHook(() =>
    useQuickSortFlow({ operatorId: 'op-1', userId: 'user-1', zones: overrides.zones ?? zones }),
  );
}

describe('useQuickSortFlow', () => {
  it('starts in scan_package with no destination', () => {
    const { result } = setup();
    expect(result.current.state).toBe('scan_package');
    expect(result.current.destination).toBeNull();
    expect(result.current.counter).toBe(0);
  });

  it('resolves the destination and arms the andén step after a package scan', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handlePackageScan('PKG-001');
    });
    expect(result.current.state).toBe('scan_anden');
    expect(result.current.destination?.zone_code).toBe('DOCK-001');
    expect(result.current.currentPackage).toMatchObject({
      id: 'pkg-1', label: 'PKG-001', orderNumber: 'ORD-1', comunaName: 'Las Condes',
    });
  });

  it('reports "Código no encontrado" and an error scan event for an unknown package', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });
    const onScanEvent = vi.fn();
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'user-1', zones, onScanEvent }),
    );
    await act(async () => {
      await result.current.handlePackageScan('UNKNOWN');
    });
    expect(result.current.error).toBe('Código no encontrado');
    expect(result.current.state).toBe('scan_package');
    expect(onScanEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNKNOWN', status: 'error' }),
    );
  });

  it('reads the sibling en_bodega count for the incomplete-order notice', async () => {
    mockNeq.mockReturnValue({ is: vi.fn().mockResolvedValue({ count: 1, error: null }) });
    const { result } = setup();
    await act(async () => {
      await result.current.handlePackageScan('PKG-001');
    });
    expect(result.current.siblingsPending).toBe(1);
  });

  it('accepts the suggested andén, records the scan, closes the batch and resets to step 1', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handlePackageScan('PKG-001');
    });
    await act(async () => {
      await result.current.handleAndenScan('DOCK-001');
    });
    expect(mockScanMutateAsync).toHaveBeenCalledWith({ barcode: 'PKG-001' });
    expect(result.current.state).toBe('scan_package');
    expect(result.current.counter).toBe(1);
    expect(result.current.destination).toBeNull();
    expect(result.current.rejectedCode).toBeNull();
  });

  it('redirects to consolidación when CONSOL is scanned, switching the batch zone first', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handlePackageScan('PKG-001');
    });
    await act(async () => {
      await result.current.handleAndenScan('CONSOL');
    });
    expect(mockUpdateBatchZone).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-1', zoneId: 'consol', operatorId: 'op-1' }),
    );
    expect(mockScanMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: 'PKG-001', redirectReason: 'manual_consolidation' }),
    );
  });

  it('rejects a wrong andén, sets rejectedCode, and keeps the flow armed (no reset)', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handlePackageScan('PKG-001');
    });
    await act(async () => {
      await result.current.handleAndenScan('WRONG-CODE');
    });
    expect(result.current.state).toBe('scan_anden');
    expect(result.current.rejectedCode).toBe('WRONG-CODE');
    expect(result.current.error).toMatch(/andén incorrecto/i);
    expect(result.current.destination?.zone_code).toBe('DOCK-001');
    expect(mockScanMutateAsync).not.toHaveBeenCalled();
  });

  describe('markException (4i — "Marcar excepción y seguir")', () => {
    it('delegates to recordQuickSortException with the rejected code, then returns to step 1', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.handlePackageScan('PKG-001');
      });
      await act(async () => {
        await result.current.handleAndenScan('WRONG-CODE');
      });
      expect(result.current.rejectedCode).toBe('WRONG-CODE');

      await act(async () => {
        await result.current.markException();
      });

      expect(mockRecordException).toHaveBeenCalledWith(
        expect.objectContaining({
          operatorId: 'op-1',
          batchId: 'batch-1',
          packageId: 'pkg-1',
          packageLabel: 'PKG-001',
          rejectedCode: 'WRONG-CODE',
          userId: 'user-1',
        }),
      );
      expect(result.current.state).toBe('scan_package');
      expect(result.current.destination).toBeNull();
      expect(result.current.rejectedCode).toBeNull();
      expect(result.current.exceptionError).toBeNull();
    });

    it('is a no-op without a pending rejection', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.markException();
      });
      expect(mockRecordException).not.toHaveBeenCalled();
    });

    // Review fix (finding #1) — a rejected write must not be swallowed and
    // treated as success: the flow stays in the rejected state (batch
    // still open, field still armed) and surfaces exceptionError, instead
    // of closing the batch and returning to step 1 as though the record
    // had been written.
    it('surfaces a failed write via exceptionError and stays in the rejected state', async () => {
      mockRecordException.mockRejectedValueOnce(new Error('permission denied'));
      const { result } = setup();
      await act(async () => {
        await result.current.handlePackageScan('PKG-001');
      });
      await act(async () => {
        await result.current.handleAndenScan('WRONG-CODE');
      });

      await act(async () => {
        await result.current.markException();
      });

      expect(result.current.exceptionError).toBe('No se pudo registrar la excepción — intenta de nuevo');
      expect(result.current.state).toBe('scan_anden');
      expect(result.current.rejectedCode).toBe('WRONG-CODE');
      expect(result.current.isMarkingException).toBe(false);
    });
  });

  describe('cancelStep2 ("Cancelar y volver al paso 1")', () => {
    it('resets to step 1 without recording anything, and no-ops with no batch open', async () => {
      const { result } = setup();
      act(() => {
        result.current.cancelStep2();
      });
      expect(mockInsert).not.toHaveBeenCalled();
      expect(result.current.state).toBe('scan_package');
    });

    it('resets to step 1 after a rejection, without recording an exception', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.handlePackageScan('PKG-001');
      });
      await act(async () => {
        await result.current.handleAndenScan('WRONG-CODE');
      });
      act(() => {
        result.current.cancelStep2();
      });
      expect(mockInsert).not.toHaveBeenCalled();
      expect(result.current.state).toBe('scan_package');
      expect(result.current.destination).toBeNull();
      expect(result.current.rejectedCode).toBeNull();
    });
  });

  it('shows the flagged consolidation warning for an unmapped comuna', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [{
        id: 'pkg-2',
        label: 'PKG-002',
        status: 'en_bodega',
        order_id: 'ord-2',
        orders: {
          order_number: 'ORD-2',
          comuna_id: 'unknown-id',
          delivery_date: '2026-03-18',
          chile_comunas: null,
        },
      }],
      error: null,
    });
    const { result } = setup();
    await act(async () => {
      await result.current.handlePackageScan('PKG-002');
    });
    expect(result.current.destination?.flagged).toBe(true);
    expect(result.current.destination?.zone_code).toBe('CONSOL');
  });

  it('auto-increments the session counter across repeated cycles', async () => {
    const { result } = setup();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await result.current.handlePackageScan('PKG-001');
      });
      await act(async () => {
        await result.current.handleAndenScan('DOCK-001');
      });
    }
    await waitFor(() => expect(result.current.counter).toBe(2));
  });
});
