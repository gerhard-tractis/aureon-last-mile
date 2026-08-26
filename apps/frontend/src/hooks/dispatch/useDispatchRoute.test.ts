import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDispatchRoute } from './useDispatchRoute';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

/**
 * spec-70 phase 4, breakage #3: "Cerrar ruta" used to be a `useState` a page
 * reload wiped. RouteBuilder now derives everything (header badge, whether
 * the scan zone is disabled, whether the seal/dispatch buttons are enabled)
 * from the route row itself, fetched here.
 */
describe('useDispatchRoute', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId is null', () => {
    const { result } = renderHook(() => useDispatchRoute(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useDispatchRoute('r1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('scopes the query to operator_id, not just route id', async () => {
    const eq = vi.fn().mockReturnThis();
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq,
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loading' },
        error: null,
      }),
    };
    mockFrom.mockReturnValue(chain);

    renderHook(() => useDispatchRoute('r1', 'op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(chain.single).toHaveBeenCalled());
    expect(eq).toHaveBeenCalledWith('id', 'r1');
    expect(eq).toHaveBeenCalledWith('operator_id', 'op-1');
  });

  it('returns the route row, including its real status', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-08-26', driver_name: null, vehicle_id: null, planned_stops: 3, completed_stops: 0, created_at: '2026-08-26T00:00:00Z', external_route_id: null },
        error: null,
      }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useDispatchRoute('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe('loaded');
  });

  it('exposes isError on Supabase failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useDispatchRoute('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
