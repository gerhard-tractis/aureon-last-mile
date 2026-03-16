import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePipelineCounts, type PipelineStageCount } from './usePipelineCounts';

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

const MOCK_COUNTS: PipelineStageCount[] = [
  { status: 'ingresado', count: 10, urgent_count: 2, alert_count: 3, late_count: 1 },
  { status: 'en_ruta', count: 5, urgent_count: 0, alert_count: 1, late_count: 0 },
];

describe('usePipelineCounts', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns pipeline counts for operator', async () => {
    mockRpc.mockResolvedValue({ data: MOCK_COUNTS, error: null });

    const { result } = renderHook(() => usePipelineCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].status).toBe('ingresado');
    expect(result.current.data![0].count).toBe(10);
    expect(result.current.data![0].urgent_count).toBe(2);
  });

  it('passes p_operator_id and no date when date not provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePipelineCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_pipeline_counts', {
      p_operator_id: 'op-1',
    });
  });

  it('passes p_date when date is provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePipelineCounts('op-1', '2026-03-16'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_pipeline_counts', {
      p_operator_id: 'op-1',
      p_date: '2026-03-16',
    });
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => usePipelineCounts(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => usePipelineCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('returns empty array when no counts', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePipelineCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
