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
    const onRoadRoutes = [
      { status: 'in_progress' },
      { status: 'dispatched' },
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
      // Second query: on-road routes — no route_date filter (QA finding #2).
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ data: onRoadRoutes, error: null }),
            }),
          }),
        }),
      };
    });

    const { result } = renderHook(() => useDispatchKPIs('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      openRoutes: 3,
      inRoute: 2,
    });
  });

  // QA finding #2 regression: a route dispatched yesterday and still on the
  // road must still count — the second query must not scope by route_date.
  it('does not filter the on-road query by route_date', async () => {
    let secondQueryEq: ReturnType<typeof vi.fn> | undefined;
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      secondQueryEq = vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      return { select: vi.fn().mockReturnValue({ eq: secondQueryEq }) };
    });

    const { result } = renderHook(() => useDispatchKPIs('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // eq should be called exactly once on the second query — for
    // operator_id only, never for route_date.
    expect(secondQueryEq).toHaveBeenCalledTimes(1);
    expect(secondQueryEq).toHaveBeenCalledWith('operator_id', 'op-1');
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
