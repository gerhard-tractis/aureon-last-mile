import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useGeneratorsByClient } from './useGeneratorsByClient';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
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

function mockChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe('useGeneratorsByClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches generators for a given operator and client', async () => {
    const generators = [
      { id: 'gen-1', name: 'Easy Maipú' },
      { id: 'gen-2', name: 'Easy Puente Alto' },
    ];
    const chain = mockChain(generators);
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useGeneratorsByClient('op-1', 'client-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(generators);
    expect(mockFrom).toHaveBeenCalledWith('generators');
    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_client_id', 'client-1');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('returns empty array when no generators exist', async () => {
    const chain = mockChain([]);
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useGeneratorsByClient('op-1', 'client-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('does not fetch when clientId is null', () => {
    const { result } = renderHook(
      () => useGeneratorsByClient('op-1', null),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fetch when operatorId is null', () => {
    const { result } = renderHook(
      () => useGeneratorsByClient(null, 'client-1'),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
