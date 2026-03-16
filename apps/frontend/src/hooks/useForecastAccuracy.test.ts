import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useForecastAccuracy } from './useForecastAccuracy';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const MOCK_ACCURACY_ROW = {
  capacity_date: '2026-03-01',
  forecasted: 100,
  actual: 95,
  accuracy_pct: 95,
};

describe('useForecastAccuracy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useForecastAccuracy(null, '2026-03-01', '2026-03-31'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('is disabled when dateFrom is empty', () => {
    const { result } = renderHook(
      () => useForecastAccuracy('op-1', '', '2026-03-31'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('is disabled when dateTo is empty', () => {
    const { result } = renderHook(
      () => useForecastAccuracy('op-1', '2026-03-01', ''),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls get_forecast_accuracy RPC with correct params', async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_ACCURACY_ROW], error: null });

    const { result } = renderHook(
      () => useForecastAccuracy('op-1', '2026-03-01', '2026-03-31'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_forecast_accuracy', {
      p_operator_id: 'op-1',
      p_date_from: '2026-03-01',
      p_date_to: '2026-03-31',
    });
  });

  it('returns forecast accuracy rows on success', async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_ACCURACY_ROW], error: null });

    const { result } = renderHook(
      () => useForecastAccuracy('op-1', '2026-03-01', '2026-03-31'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].capacity_date).toBe('2026-03-01');
    expect(result.current.data![0].accuracy_pct).toBe(95);
  });

  it('returns empty array when RPC returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(
      () => useForecastAccuracy('op-1', '2026-03-01', '2026-03-31'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('throws when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(
      () => useForecastAccuracy('op-1', '2026-03-01', '2026-03-31'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
