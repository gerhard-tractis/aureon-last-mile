import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUnmatchedComunas } from './useUnmatchedComunas';

let mockRpcResult: { data: unknown; error: unknown } = { data: [], error: null };
let mockSupabase: { rpc: ReturnType<typeof vi.fn> };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpcResult = { data: [], error: null };
  mockSupabase = { rpc: vi.fn().mockImplementation(() => Promise.resolve(mockRpcResult)) };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useUnmatchedComunas', () => {
  it('returns empty array when all communes matched', async () => {
    const { result } = renderHook(() => useUnmatchedComunas('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns unmatched communes with order count', async () => {
    mockRpcResult = {
      data: [
        { comuna_raw: 'San miguel', order_count: 12 },
        { comuna_raw: 'LA REINA',   order_count: 3  },
      ],
      error: null,
    };
    const { result } = renderHook(() => useUnmatchedComunas('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0]).toMatchObject({ comuna_raw: 'San miguel', order_count: 12 });
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useUnmatchedComunas(null), { wrapper });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
