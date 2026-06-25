import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockOrder = vi.fn();
const mockIs = vi.fn(() => ({ order: mockOrder }));
const mockEq2 = vi.fn(() => ({ is: mockIs }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

import { useIncomingRoutes } from './useIncomingRoutes';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useIncomingRoutes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fire when operatorId is null', () => {
    renderHook(() => useIncomingRoutes(null), { wrapper: wrapperFactory() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('queries pickup_routes filtered by status=in_transit and maps driver_name + counts', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'r1', code: 'PR-2026-0001', driver_id: 'd1',
          vehicle_label: 'AAA-111', in_transit_at: '2026-06-25T08:00:00Z',
          driver: { full_name: 'Ana Ruiz' },
          manifests: [{ id: 'm1', total_packages: 10 }, { id: 'm2', total_packages: 5 }],
          route_receptions: [{ expected_count: 15 }],
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useIncomingRoutes('op-1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith('pickup_routes');
    expect(mockEq1).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(mockEq2).toHaveBeenCalledWith('status', 'in_transit');
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'r1',
        code: 'PR-2026-0001',
        driver_name: 'Ana Ruiz',
        manifest_count: 2,
        expected_packages: 15,
      }),
    ]);
  });

  it('falls back to summing total_packages when route_reception is missing', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'r2', code: 'PR-2026-0002', driver_id: 'd2',
          vehicle_label: null, in_transit_at: null,
          driver: null,
          manifests: [{ id: 'm3', total_packages: 7 }],
          route_receptions: [],
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useIncomingRoutes('op-1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].expected_packages).toBe(7);
    expect(result.current.data?.[0].driver_name).toBeNull();
  });
});
