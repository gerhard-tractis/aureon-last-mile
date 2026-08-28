import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useMoveTaskSnapshot } from './useMoveTaskSnapshot';
import type { MoveTaskSnapshot } from '@/lib/types';

const MOCK_SNAPSHOT: MoveTaskSnapshot = {
  generated_at: '2026-08-28T12:00:00Z',
  routes: [
    {
      route_id: 'route-1',
      external_route_id: 'R-042',
      driver_name: 'Juan Pérez',
      load_position_id: 'pos-1',
      load_position_code: 'POS-02',
      load_position_label: 'Frente a Andén A2',
      total_packages: 37,
      remaining_packages: 14,
      offset_conflict: false,
      groups: [
        { dock_zone_id: 'zone-a1', dock_zone_code: 'A1', dock_zone_name: 'Andén A1', is_retired: false, remaining_count: 6 },
        { dock_zone_id: 'zone-a3', dock_zone_code: 'A3', dock_zone_name: 'Andén A3', is_retired: false, remaining_count: 8 },
      ],
    },
  ],
  unassigned_routes: [
    {
      route_id: 'route-2',
      external_route_id: 'R-043',
      driver_name: null,
      total_packages: 5,
      remaining_packages: 5,
    },
  ],
};

let mockRpcResult: { data: unknown; error: unknown } = { data: MOCK_SNAPSHOT, error: null };
let mockSupabase: { rpc: ReturnType<typeof vi.fn> };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpcResult = { data: MOCK_SNAPSHOT, error: null };
  mockSupabase = {
    rpc: vi.fn().mockImplementation(() => Promise.resolve(mockRpcResult)),
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMoveTaskSnapshot', () => {
  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useMoveTaskSnapshot(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls get_move_task_snapshot with the operator id', async () => {
    const { result } = renderHook(() => useMoveTaskSnapshot('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_move_task_snapshot', {
      p_operator_id: 'op-1',
    });
  });

  it('returns the parsed snapshot on success', async () => {
    const { result } = renderHook(() => useMoveTaskSnapshot('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces error state when the rpc fails', async () => {
    mockRpcResult = { data: null, error: { message: 'DB error' } };

    const { result } = renderHook(() => useMoveTaskSnapshot('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.snapshot).toBeNull();
  });

  it('scopes the query key to the operator', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const W = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const hook1 = renderHook(() => useMoveTaskSnapshot('op-1'), { wrapper: W });
    const hook2 = renderHook(() => useMoveTaskSnapshot('op-2'), { wrapper: W });

    await waitFor(() => expect(hook1.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(hook2.result.current.isSuccess).toBe(true));

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
  });
});
