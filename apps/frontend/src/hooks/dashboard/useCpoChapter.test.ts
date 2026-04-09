import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCpoChapter } from './useCpoChapter';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

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

const PERIOD: DashboardPeriod = {
  preset: 'month',
  year: 2026,
  month: 4,
  start: new Date('2026-04-01T00:00:00'),
  end: new Date('2026-04-30T23:59:59'),
};

const TACTICS_ROW = {
  fadr_pct: 0.95,
  avg_km_per_route: 120.5,
  avg_km_per_stop: 8.3,
  avg_orders_per_route: 14.5,
};

describe('useCpoChapter', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('calls RPC with correct params including ISO date strings', async () => {
    mockRpc.mockResolvedValue({ data: [TACTICS_ROW], error: null });

    const { result } = renderHook(() => useCpoChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith('get_dashboard_route_tactics', {
      p_operator_id: 'op-1',
      p_start: '2026-04-01',
      p_end: '2026-04-30',
    });
  });

  it('returns routeTactics with all 4 fields', async () => {
    mockRpc.mockResolvedValue({ data: [TACTICS_ROW], error: null });

    const { result } = renderHook(() => useCpoChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.routeTactics).toEqual(TACTICS_ROW);
    expect(result.current.routeTactics?.fadr_pct).toBe(0.95);
    expect(result.current.routeTactics?.avg_km_per_route).toBe(120.5);
    expect(result.current.routeTactics?.avg_km_per_stop).toBe(8.3);
    expect(result.current.routeTactics?.avg_orders_per_route).toBe(14.5);
  });

  it('returns routeTactics null when RPC returns empty data', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useCpoChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.routeTactics).toBeNull();
  });

  it('is disabled (fetchStatus idle) when operatorId is empty', () => {
    const { result } = renderHook(() => useCpoChapter('', PERIOD), { wrapper: wrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('isError is true when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => useCpoChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
