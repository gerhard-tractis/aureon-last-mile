import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useDockZoneAdjacencyPairs,
  useAddDockZoneAdjacencyPair,
  useRemoveDockZoneAdjacencyPair,
} from './useDockZoneAdjacency';

let mockQueryResult: { data: unknown; error: unknown } = { data: [], error: null };
const mockRpc = vi.fn();

function createSelectChain(): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => resolve(mockQueryResult);
  return chain;
}

let mockFromFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn, rpc: mockRpc })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryResult = { data: [], error: null };
  mockFromFn = vi.fn().mockImplementation(() => createSelectChain());
  mockRpc.mockResolvedValue({ data: null, error: null });
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useDockZoneAdjacencyPairs', () => {
  it('returns an empty list when no pairs are configured', async () => {
    const { result } = renderHook(() => useDockZoneAdjacencyPairs('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('dedupes the two directional rows a symmetric pair produces into ONE entry', async () => {
    mockQueryResult = {
      data: [
        {
          id: 'row-a-to-b',
          dock_zone_id: 'zone-a',
          adjacent_zone_id: 'zone-b',
          dock_zone: { id: 'zone-a', name: 'Andén A', code: 'A' },
          adjacent_zone: { id: 'zone-b', name: 'Andén B', code: 'B' },
        },
        {
          id: 'row-b-to-a',
          dock_zone_id: 'zone-b',
          adjacent_zone_id: 'zone-a',
          dock_zone: { id: 'zone-b', name: 'Andén B', code: 'B' },
          adjacent_zone: { id: 'zone-a', name: 'Andén A', code: 'A' },
        },
      ],
      error: null,
    };

    const { result } = renderHook(() => useDockZoneAdjacencyPairs('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].zoneACode).toBe('A');
    expect(result.current.data?.[0].zoneBCode).toBe('B');
  });

  it('renders two separate pairs when zones are genuinely different adjacencies', async () => {
    mockQueryResult = {
      data: [
        {
          id: 'row-1',
          dock_zone_id: 'zone-a',
          adjacent_zone_id: 'zone-b',
          dock_zone: { id: 'zone-a', name: 'Andén A', code: 'A' },
          adjacent_zone: { id: 'zone-b', name: 'Andén B', code: 'B' },
        },
        {
          id: 'row-2',
          dock_zone_id: 'zone-b',
          adjacent_zone_id: 'zone-a',
          dock_zone: { id: 'zone-b', name: 'Andén B', code: 'B' },
          adjacent_zone: { id: 'zone-a', name: 'Andén A', code: 'A' },
        },
        {
          id: 'row-3',
          dock_zone_id: 'zone-a',
          adjacent_zone_id: 'zone-c',
          dock_zone: { id: 'zone-a', name: 'Andén A', code: 'A' },
          adjacent_zone: { id: 'zone-c', name: 'Andén C', code: 'C' },
        },
        {
          id: 'row-4',
          dock_zone_id: 'zone-c',
          adjacent_zone_id: 'zone-a',
          dock_zone: { id: 'zone-c', name: 'Andén C', code: 'C' },
          adjacent_zone: { id: 'zone-a', name: 'Andén A', code: 'A' },
        },
      ],
      error: null,
    };

    const { result } = renderHook(() => useDockZoneAdjacencyPairs('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
  });
});

describe('useAddDockZoneAdjacencyPair', () => {
  it('calls add_dock_zone_adjacency_pair exactly ONCE — the RPC writes both directions, the client must not', async () => {
    const { result } = renderHook(() => useAddDockZoneAdjacencyPair('op-1'), { wrapper });

    result.current.mutate({ dockZoneId: 'zone-a', adjacentZoneId: 'zone-b' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('add_dock_zone_adjacency_pair', {
      p_dock_zone_id: 'zone-a',
      p_adjacent_zone_id: 'zone-b',
    });
  });

  it('surfaces the RPC error (e.g. the role-gate refusal) rather than swallowing it', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Solo un responsable puede configurar la adyacencia de andenes.' } });
    const { result } = renderHook(() => useAddDockZoneAdjacencyPair('op-1'), { wrapper });

    result.current.mutate({ dockZoneId: 'zone-a', adjacentZoneId: 'zone-b' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('responsable');
  });
});

describe('useRemoveDockZoneAdjacencyPair', () => {
  it('calls remove_dock_zone_adjacency_pair exactly ONCE — the RPC soft-deletes both directions, the client must not', async () => {
    const { result } = renderHook(() => useRemoveDockZoneAdjacencyPair('op-1'), { wrapper });

    result.current.mutate({ dockZoneId: 'zone-a', adjacentZoneId: 'zone-b' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('remove_dock_zone_adjacency_pair', {
      p_dock_zone_id: 'zone-a',
      p_adjacent_zone_id: 'zone-b',
    });
  });
});
