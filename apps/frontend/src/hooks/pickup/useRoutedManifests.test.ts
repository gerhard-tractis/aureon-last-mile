import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRoutedManifests } from './useRoutedManifests';

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

describe('useRoutedManifests', () => {
  it('does not fetch when operatorId is null', () => {
    renderHook(() => useRoutedManifests(null), { wrapper: createWrapper() });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls get_routed_manifests, not get_pending_manifests or get_completed_manifests', async () => {
    mockRpc.mockClear();
    const mockData = [
      {
        id: 'm1',
        external_load_id: 'CARGA-001',
        retailer_name: 'Easy',
        total_orders: 5,
        total_packages: 12,
        created_at: '2026-09-10T09:00:00Z',
        pickup_point: 'Easy Vespucio',
        labels_printed_at: null,
        labels_printed_by_name: null,
        route_code: 'PR-2026-0042',
        route_started_at: '2026-09-10T08:00:00Z',
        driver_name: 'Juan Pérez',
        route_status: 'in_progress',
        closed_at: null,
        missing_count: 0,
        verified_count: 3,
      },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => useRoutedManifests('op-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_routed_manifests', undefined);
  });

  it('handles errors', async () => {
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: null, error: { message: 'fail' } });

    const { result } = renderHook(() => useRoutedManifests('op-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
