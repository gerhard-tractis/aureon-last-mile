import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useChileComunas } from './useChileComunas';

let mockResult: { data: unknown; error: unknown } = { data: [], error: null };
let mockFromFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResult = { data: [], error: null };
  mockFromFn = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockImplementation(() => Promise.resolve(mockResult)),
    }),
  });
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useChileComunas', () => {
  it('returns empty array when table is empty', async () => {
    const { result } = renderHook(() => useChileComunas(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns communes with id, nombre, region, region_num', async () => {
    mockResult = {
      data: [
        { id: 'c1', nombre: 'Las Condes', region: 'Metropolitana de Santiago', region_num: 13 },
        { id: 'c2', nombre: 'Providencia', region: 'Metropolitana de Santiago', region_num: 13 },
      ],
      error: null,
    };
    mockFromFn = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockImplementation(() => Promise.resolve(mockResult)),
      }),
    });
    const { result } = renderHook(() => useChileComunas(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0]).toMatchObject({ id: 'c1', nombre: 'Las Condes' });
  });
});
