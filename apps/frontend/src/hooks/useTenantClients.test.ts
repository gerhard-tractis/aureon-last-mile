import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTenantClients } from './useTenantClients';

const mockOrder = vi.fn();
const mockIs = vi.fn().mockReturnValue({ order: mockOrder });
const mockEq = vi.fn().mockReturnValue({ is: mockIs });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useTenantClients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockReset();
    mockIs.mockReturnValue({ order: mockOrder });
    mockEq.mockReturnValue({ is: mockIs });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useTenantClients(null),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fetches tenant_clients with correct params', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 'c-1', name: 'Retailer A' }],
      error: null,
    });

    const { result } = renderHook(
      () => useTenantClients('op-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith('tenant_clients');
    expect(mockSelect).toHaveBeenCalledWith('id, name');
    expect(mockEq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(mockIs).toHaveBeenCalledWith('deleted_at', null);
    expect(mockOrder).toHaveBeenCalledWith('name');
  });

  it('returns tenant clients on success', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'c-1', name: 'Retailer A' },
        { id: 'c-2', name: 'Retailer B' },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useTenantClients('op-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe('Retailer A');
  });

  it('returns empty array when query returns null data', async () => {
    mockOrder.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(
      () => useTenantClients('op-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('throws when query returns error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(
      () => useTenantClients('op-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
