import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDispatchKPIs } from './useDispatchKPIs';

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

describe('useDispatchKPIs', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useDispatchKPIs(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns correct KPI values on success', async () => {
    const openRoutes = [
      { planned_stops: 5 },
      { planned_stops: 3 },
      { planned_stops: 7 },
    ];
    const todayRoutes = [
      { status: 'in_progress' },
      { status: 'in_progress' },
      { status: 'completed' },
    ];

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First query: open routes
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ data: openRoutes, error: null }),
              }),
            }),
          }),
        };
      }
      // Second query: today's dispatched
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ data: todayRoutes, error: null }),
              }),
            }),
          }),
        }),
      };
    });

    const { result } = renderHook(() => useDispatchKPIs('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      openRoutes: 3,
      pendingPackages: 15,
      dispatchedToday: 3,
      inRoute: 2,
    });
  });

  it('handles error from open routes query', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'DB error', code: '42P01' },
            }),
          }),
        }),
      }),
    }));

    const { result } = renderHook(() => useDispatchKPIs('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });
});
