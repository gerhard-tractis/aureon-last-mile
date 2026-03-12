import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePendingManifests, useCompletedManifests } from './useManifests';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    rpc: mockRpc,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('usePendingManifests', () => {
  it('does not fetch when operatorId is null', () => {
    renderHook(() => usePendingManifests(null), { wrapper: createWrapper() });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fetches pending manifests when operatorId is provided', async () => {
    const mockData = [
      { external_load_id: 'CARGA-001', retailer_name: 'Easy', order_count: 5, package_count: 10 },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => usePendingManifests('op-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_pending_manifests');
  });

  it('handles errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'fail' } });

    const { result } = renderHook(() => usePendingManifests('op-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCompletedManifests', () => {
  it('does not fetch when operatorId is null', () => {
    mockRpc.mockClear();
    renderHook(() => useCompletedManifests(null), { wrapper: createWrapper() });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fetches completed manifests when operatorId is provided', async () => {
    const mockData = [
      { id: 'abc', external_load_id: 'CARGA-002', retailer_name: 'Sodimac', total_orders: 3, total_packages: 8, completed_at: '2026-03-10T12:00:00Z' },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => useCompletedManifests('op-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_completed_manifests');
  });
});
