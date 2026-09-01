import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRouteTerritoryHistory } from './useRouteTerritoryHistory';

let mockRpcResult: { data: unknown; error: unknown } = { data: [], error: null };
let mockSupabase: { rpc: ReturnType<typeof vi.fn> };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpcResult = { data: [], error: null };
  mockSupabase = { rpc: vi.fn().mockImplementation(() => Promise.resolve(mockRpcResult)) };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useRouteTerritoryHistory', () => {
  it('is idle when routeId is null', () => {
    const { result } = renderHook(() => useRouteTerritoryHistory(null, 'op-1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useRouteTerritoryHistory('route-1', null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls the RPC with p_route_id and p_operator_id', async () => {
    const { result } = renderHook(() => useRouteTerritoryHistory('route-1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_route_territory_history', {
      p_route_id: 'route-1',
      p_operator_id: 'op-1',
    });
  });

  it('maps snake_case RPC rows to camelCase entries', async () => {
    mockRpcResult = {
      data: [
        {
          comuna_id: 'comuna-1',
          comuna_name: 'Ñuñoa',
          driver_name: 'Juan Pérez',
          run_count: 3,
          last_route_date: '2026-08-20',
        },
      ],
      error: null,
    };
    const { result } = renderHook(() => useRouteTerritoryHistory('route-1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        comunaId: 'comuna-1',
        comunaName: 'Ñuñoa',
        driverName: 'Juan Pérez',
        runCount: 3,
        lastRouteDate: '2026-08-20',
      },
    ]);
  });

  it('returns an empty array when there is no territory history', async () => {
    const { result } = renderHook(() => useRouteTerritoryHistory('route-1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('exposes isError when the RPC fails', async () => {
    mockRpcResult = { data: null, error: new Error('ROUTE_NOT_FOUND') };
    const { result } = renderHook(() => useRouteTerritoryHistory('route-1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
