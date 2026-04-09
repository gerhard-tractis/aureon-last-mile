import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useOtifChapter } from './useOtifChapter';
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

describe('useOtifChapter', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('calls all three RPCs with correct p_start and p_end ISO date strings', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useOtifChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const calls = mockRpc.mock.calls;
    const rpcNames = calls.map((c) => c[0]);
    expect(rpcNames).toContain('get_dashboard_otif_by_region');
    expect(rpcNames).toContain('get_dashboard_otif_by_customer');
    expect(rpcNames).toContain('get_dashboard_late_reasons');

    for (const [, args] of calls) {
      expect(args.p_operator_id).toBe('op-1');
      expect(args.p_start).toBe('2026-04-01');
      expect(args.p_end).toBe('2026-04-30');
    }
  });

  it('returns { byRegion, byCustomer, lateReasons } with data from RPCs', async () => {
    const byRegionData = [{ region: 'Norte', otif_pct: 0.9 }];
    const byCustomerData = [{ customer_name: 'Acme', otif_pct: 0.85 }];
    const lateReasonsData = [{ reason: 'Traffic', count: 10 }];

    mockRpc.mockImplementation((name: string) => {
      if (name === 'get_dashboard_otif_by_region') return Promise.resolve({ data: byRegionData, error: null });
      if (name === 'get_dashboard_otif_by_customer') return Promise.resolve({ data: byCustomerData, error: null });
      if (name === 'get_dashboard_late_reasons') return Promise.resolve({ data: lateReasonsData, error: null });
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHook(() => useOtifChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.byRegion).toEqual(byRegionData);
    expect(result.current.byCustomer).toEqual(byCustomerData);
    expect(result.current.lateReasons).toEqual(lateReasonsData);
  });

  it('isLoading is true when any query is loading', () => {
    mockRpc.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useOtifChapter('op-1', PERIOD), { wrapper: wrapper() });

    expect(result.current.isLoading).toBe(true);
  });

  it('isError is true when any query errors', async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === 'get_dashboard_otif_by_region') return Promise.resolve({ data: null, error: { message: 'fail' } });
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHook(() => useOtifChapter('op-1', PERIOD), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
