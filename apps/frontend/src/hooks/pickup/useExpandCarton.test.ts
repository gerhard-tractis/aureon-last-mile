import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useExpandCarton } from './useExpandCarton';

function wrapperFactory(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useExpandCarton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls expand_carton with the package id, box count and reason, and maps the out_-prefixed response', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          out_id: 'p2', out_label: 'CTN001-2', out_package_number: '2 de 3',
          out_declared_box_count: 3, out_parent_label: 'CTN001',
          out_is_generated_label: true, out_order_id: 'o1',
        },
      ],
      error: null,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    const { result } = renderHook(() => useExpandCarton(), { wrapper: wrapperFactory(qc) });

    result.current.mutate({ packageId: 'p1', additionalBoxes: 2, reason: 'Producto de varias cajas' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('expand_carton', {
      p_package_id: 'p1',
      p_additional_boxes: 2,
      p_reason: 'Producto de varias cajas',
    });
    expect(result.current.data).toEqual([
      { id: 'p2', label: 'CTN001-2', package_number: '2 de 3', declared_box_count: 3, parent_label: 'CTN001', is_generated_label: true, order_id: 'o1' },
    ]);
  });

  it('invalidates every manifest-orders query on success', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useExpandCarton(), { wrapper: wrapperFactory(qc) });
    result.current.mutate({ packageId: 'p1', additionalBoxes: 1, reason: 'motivo' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pickup', 'manifest-orders'] });
  });

  it('surfaces an error from the RPC (e.g. a parent past verificado)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'cannot expand a carton once it has moved past verificado' },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    const { result } = renderHook(() => useExpandCarton(), { wrapper: wrapperFactory(qc) });
    result.current.mutate({ packageId: 'p1', additionalBoxes: 1, reason: 'motivo' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/past verificado/);
  });
});
