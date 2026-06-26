import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

const mockValidate = vi.fn();
vi.mock('@/lib/reception/reception-scan-validator', () => ({
  validateReceptionScan: (...args: unknown[]) => mockValidate(...args),
}));

vi.mock('@/lib/pickup/audio', () => ({ playFeedback: vi.fn() }));

import { useReceptionScan } from './useReceptionScan';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return { Wrapper, qc };
}

describe('useReceptionScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it('inserts reception_scans against the route_receptions id when validator succeeds', async () => {
    mockValidate.mockResolvedValue({
      scanResult: 'received', packageId: 'p1', packageLabel: 'PKG-A',
    });

    const { Wrapper } = wrapperFactory();
    const { result } = renderHook(() => useReceptionScan(), { wrapper: Wrapper });

    result.current.mutate({
      barcode: 'PKG-A', routeId: 'r1', routeReceptionId: 'rr1',
      operatorId: 'op-1', userId: 'u1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith('reception_scans');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      reception_id: 'rr1',
      operator_id: 'op-1',
      package_id: 'p1',
      barcode: 'PKG-A',
      scan_result: 'received',
      scanned_by: 'u1',
    }));
  });

  it('still inserts a not_found scan (recorded as discrepancy)', async () => {
    mockValidate.mockResolvedValue({
      scanResult: 'not_found', packageId: null, packageLabel: null,
      message: 'Paquete no pertenece a esta carga',
    });

    const { Wrapper } = wrapperFactory();
    const { result } = renderHook(() => useReceptionScan(), { wrapper: Wrapper });

    result.current.mutate({
      barcode: 'NOPE', routeId: 'r1', routeReceptionId: 'rr1',
      operatorId: 'op-1', userId: 'u1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      scan_result: 'not_found',
      package_id: null,
    }));
  });

  it('invalidates the snapshot query on success', async () => {
    mockValidate.mockResolvedValue({ scanResult: 'received', packageId: 'p1', packageLabel: 'X' });

    const { Wrapper, qc } = wrapperFactory();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useReceptionScan(), { wrapper: Wrapper });

    result.current.mutate({
      barcode: 'X', routeId: 'route-42', routeReceptionId: 'rr1',
      operatorId: 'op-1', userId: 'u1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({
      queryKey: ['reception', 'route-snapshot', 'route-42'],
    });
  });
});
