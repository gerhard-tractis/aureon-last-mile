import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePriorityCounts } from './usePriorityCounts';
import type { PipelineStageCount } from './usePipelineCounts';

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

describe('usePriorityCounts', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns zero counts when no data (empty array)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.urgent).toBe(0);
    expect(result.current.alert).toBe(0);
    expect(result.current.late).toBe(0);
    expect(result.current.ok).toBe(0);
  });

  it('correctly sums urgent_count across all stages', async () => {
    const counts: PipelineStageCount[] = [
      { status: 'ingresado', count: 10, urgent_count: 2, alert_count: 0, late_count: 0 },
      { status: 'en_ruta', count: 5, urgent_count: 3, alert_count: 0, late_count: 0 },
    ];
    mockRpc.mockResolvedValue({ data: counts, error: null });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.urgent).toBe(5);
  });

  it('correctly sums alert_count across all stages', async () => {
    const counts: PipelineStageCount[] = [
      { status: 'ingresado', count: 10, urgent_count: 0, alert_count: 3, late_count: 0 },
      { status: 'en_ruta', count: 5, urgent_count: 0, alert_count: 1, late_count: 0 },
    ];
    mockRpc.mockResolvedValue({ data: counts, error: null });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.alert).toBe(4);
  });

  it('correctly sums late_count across all stages', async () => {
    const counts: PipelineStageCount[] = [
      { status: 'ingresado', count: 10, urgent_count: 0, alert_count: 0, late_count: 2 },
      { status: 'en_ruta', count: 5, urgent_count: 0, alert_count: 0, late_count: 4 },
    ];
    mockRpc.mockResolvedValue({ data: counts, error: null });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.late).toBe(6);
  });

  it('ok = total count - urgent - alert - late', async () => {
    const counts: PipelineStageCount[] = [
      { status: 'ingresado', count: 10, urgent_count: 2, alert_count: 3, late_count: 1 },
      { status: 'en_ruta', count: 5, urgent_count: 0, alert_count: 1, late_count: 0 },
    ];
    mockRpc.mockResolvedValue({ data: counts, error: null });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // total = 10 + 5 = 15, urgent = 2, alert = 4, late = 1
    // ok = 15 - 2 - 4 - 1 = 8
    expect(result.current.ok).toBe(8);
  });

  it('floors ok at 0 when priority counts exceed total count', async () => {
    const counts: PipelineStageCount[] = [
      // Hypothetical scenario where DB counts are inconsistent
      { status: 'ingresado', count: 3, urgent_count: 2, alert_count: 2, late_count: 1 },
    ];
    mockRpc.mockResolvedValue({ data: counts, error: null });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // total = 3, urgent = 2, alert = 2, late = 1 → raw ok = 3 - 2 - 2 - 1 = -2 → floored at 0
    expect(result.current.ok).toBe(0);
  });

  it('propagates isLoading = true when query is loading', () => {
    // Make rpc never resolve so query stays pending
    mockRpc.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    expect(result.current.isLoading).toBe(true);
  });

  it('propagates isError = true when query errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => usePriorityCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
