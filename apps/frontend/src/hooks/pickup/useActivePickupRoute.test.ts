import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockGetUser = vi.fn();
let mockQueryResult: { data: unknown; error: unknown } = { data: [], error: null };

function buildChain() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockImplementation(() => Promise.resolve(mockQueryResult));
  return chain;
}

const mockFrom = vi.fn(() => buildChain());

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  }),
}));

import { useActivePickupRoute } from './useActivePickupRoute';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useActivePickupRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'driver-1' } }, error: null });
    mockQueryResult = { data: [], error: null };
  });

  it('returns null when no active route', async () => {
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('returns the active route when one exists', async () => {
    const route = {
      id: 'route-1',
      operator_id: 'op-1',
      driver_id: 'driver-1',
      code: 'PR-2026-0001',
      status: 'in_progress',
    };
    mockQueryResult = { data: [route], error: null };

    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(route);
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useActivePickupRoute(null), { wrapper: wrapperFactory() });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
