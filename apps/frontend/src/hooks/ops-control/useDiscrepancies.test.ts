import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDiscrepancies, type DiscrepancyRow } from './useDiscrepancies';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
}

const MOCK_ROW: DiscrepancyRow = {
  id: 'disc-1',
  kind: 'missing',
  operation_type: 'reception',
  status: 'open',
  detected_at: '2026-09-07T10:00:00Z',
  note: 'no llegó',
  order_number: 'ORD-01',
  package_label: 'CTN-1',
  carga: 'CARGA-EASY-001',
  ruta: 'PR-2026-2298',
  closed_by_name: 'Ana Recepción',
  total_count: 1,
};

describe('useDiscrepancies', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns open discrepancies by default', async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_ROW], error: null });

    const { result } = renderHook(() => useDiscrepancies('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_discrepancies_ops_control', { p_status: 'open' });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].order_number).toBe('ORD-01');
    expect(result.current.data![0].carga).toBe('CARGA-EASY-001');
  });

  it('passes a custom status through to the RPC', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useDiscrepancies('op-1', 'resolved'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_discrepancies_ops_control', { p_status: 'resolved' });
  });

  it('returns empty array when there are none', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useDiscrepancies('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when operatorId is empty', () => {
    const { result } = renderHook(() => useDiscrepancies(''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws when the RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => useDiscrepancies('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
