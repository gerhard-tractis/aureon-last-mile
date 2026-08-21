import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockLimit = vi.fn();
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockNot = vi.fn(() => ({ order: mockOrder }));
const mockIs = vi.fn(() => ({ not: mockNot }));
const mockEq = vi.fn(() => ({ is: mockIs }));
const mockSelect = vi.fn((_query: string) => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

import { useOpenDiscrepancies } from './useOpenDiscrepancies';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useOpenDiscrepancies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fire when operatorId is null', () => {
    renderHook(() => useOpenDiscrepancies(null), { wrapper: wrapperFactory() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('maps pickup_route_id to routeId and derives delta from expected - received', async () => {
    mockLimit.mockResolvedValue({
      data: [
        {
          id: 'rr1',
          expected_count: 12,
          received_count: 9,
          completed_at: '2026-06-25T08:00:00Z',
          pickup_route_id: 'r1',
          pickup_routes: { code: 'PR-2026-0148' },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useOpenDiscrepancies('op-1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith('route_receptions');
    expect(mockEq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'rr1',
        routeId: 'r1',
        routeCode: 'PR-2026-0148',
        expected: 12,
        received: 9,
        delta: 3,
      }),
    ]);
  });
});
