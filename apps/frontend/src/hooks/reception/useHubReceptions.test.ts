import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- Mocks ---

let mockReceptionData: unknown = null;
let mockUpdateError: unknown = null;
let mockManifestUpdateError: unknown = null;

function createQueryChain(data: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({
    data: data,
    error: data ? null : { code: 'PGRST116' },
  });
  return chain;
}

function createUpdateChain(error: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockImplementation(() => {
    // Return an object that supports chaining .eq() again (final call resolves)
    return {
      eq: vi.fn().mockResolvedValue({ error }),
    };
  });
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'hub_receptions') {
        // Combine query chain and update chain capabilities
        const queryChain = createQueryChain(mockReceptionData);
        const updateChain = createUpdateChain(mockUpdateError);
        return {
          ...queryChain,
          update: updateChain.update,
        };
      }
      if (table === 'manifests') {
        return createUpdateChain(mockManifestUpdateError);
      }
      return createQueryChain(null);
    },
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

describe('useHubReception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReceptionData = null;
    mockUpdateError = null;
    mockManifestUpdateError = null;
  });

  it('fetches reception detail by id', async () => {
    mockReceptionData = {
      id: 'rec-1',
      manifest_id: 'manifest-1',
      expected_count: 10,
      received_count: 8,
      status: 'in_progress',
      discrepancy_notes: null,
      manifests: { id: 'manifest-1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
    };

    const { useHubReception } = await import('./useHubReceptions');
    const { result } = renderHook(
      () => useHubReception('rec-1', 'op-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.id).toBe('rec-1');
    expect(result.current.data?.expected_count).toBe(10);
    expect(result.current.data?.received_count).toBe(8);
  });

  it('is disabled when receptionId is null', async () => {
    const { useHubReception } = await import('./useHubReceptions');
    const { result } = renderHook(
      () => useHubReception(null, 'op-1'),
      { wrapper: createWrapper() }
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  it('is disabled when operatorId is null', async () => {
    const { useHubReception } = await import('./useHubReceptions');
    const { result } = renderHook(
      () => useHubReception('rec-1', null),
      { wrapper: createWrapper() }
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });
});

describe('useCompleteReception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReceptionData = null;
    mockUpdateError = null;
    mockManifestUpdateError = null;
  });

  it('completes reception successfully', async () => {
    const { useCompleteReception } = await import('./useHubReceptions');
    const { result } = renderHook(
      () => useCompleteReception(),
      { wrapper: createWrapper() }
    );

    result.current.mutate({
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
      discrepancyNotes: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('stores discrepancy notes when provided', async () => {
    const { useCompleteReception } = await import('./useHubReceptions');
    const { result } = renderHook(
      () => useCompleteReception(),
      { wrapper: createWrapper() }
    );

    result.current.mutate({
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
      discrepancyNotes: 'Faltan 2 bultos del pedido ORD-500',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('handles update errors', async () => {
    mockUpdateError = { message: 'update failed' };

    const { useCompleteReception } = await import('./useHubReceptions');
    const { result } = renderHook(
      () => useCompleteReception(),
      { wrapper: createWrapper() }
    );

    result.current.mutate({
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
      discrepancyNotes: null,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
