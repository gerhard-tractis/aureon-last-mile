import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useNorthStars } from './useNorthStars';

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

const CURRENT_ROW = {
  row_type: 'current' as const,
  period_year: 2026,
  period_month: 4,
  cpo_clp: 1500,
  otif_pct: 0.92,
  nps_score: 45,
  csat_pct: 0.88,
  total_orders: 1000,
  delivered_orders: 920,
  failed_orders: 80,
  computed_at: '2026-04-09T00:00:00Z',
};

const PRIOR_MONTH_ROW = {
  ...CURRENT_ROW,
  row_type: 'prior_month' as const,
  period_year: 2026,
  period_month: 3,
};

const PRIOR_YEAR_ROW = {
  ...CURRENT_ROW,
  row_type: 'prior_year' as const,
  period_year: 2025,
  period_month: 4,
};

describe('useNorthStars', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('calls RPC with correct args', async () => {
    mockRpc.mockResolvedValue({ data: [CURRENT_ROW], error: null });

    const { result } = renderHook(() => useNorthStars('op-1', 2026, 4), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_dashboard_north_stars', {
      p_operator_id: 'op-1',
      p_year: 2026,
      p_month: 4,
    });
  });

  it('returns { current, priorMonth, priorYear } from 3 rows', async () => {
    mockRpc.mockResolvedValue({
      data: [CURRENT_ROW, PRIOR_MONTH_ROW, PRIOR_YEAR_ROW],
      error: null,
    });

    const { result } = renderHook(() => useNorthStars('op-1', 2026, 4), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.current?.row_type).toBe('current');
    expect(result.current.data?.priorMonth?.row_type).toBe('prior_month');
    expect(result.current.data?.priorYear?.row_type).toBe('prior_year');
  });

  it('returns priorYear null when RPC returns only 2 rows (no prior_year)', async () => {
    mockRpc.mockResolvedValue({
      data: [CURRENT_ROW, PRIOR_MONTH_ROW],
      error: null,
    });

    const { result } = renderHook(() => useNorthStars('op-1', 2026, 4), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.current).not.toBeNull();
    expect(result.current.data?.priorMonth).not.toBeNull();
    expect(result.current.data?.priorYear).toBeNull();
  });

  it('isError is true when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => useNorthStars('op-1', 2026, 4), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('isLoading is true initially before RPC resolves', () => {
    mockRpc.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useNorthStars('op-1', 2026, 4), { wrapper: wrapper() });

    expect(result.current.isLoading).toBe(true);
  });

  it('is disabled (fetchStatus idle) when operatorId is empty', () => {
    const { result } = renderHook(() => useNorthStars('', 2026, 4), { wrapper: wrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
