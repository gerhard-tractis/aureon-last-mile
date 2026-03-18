import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- Mocks ---

let mockScansData: unknown[] = [];
let mockInsertError: unknown = null;
let mockUpdateError: unknown = null;
let mockReceptionData: unknown = null;

function createChain(data: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error: null });
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({
    data: data[0] ?? null,
    error: data.length ? null : { code: 'PGRST116' },
  });
  chain.insert = vi.fn().mockResolvedValue({ error: mockInsertError });
  chain.update = vi.fn().mockReturnValue(chain);
  chain.match = vi.fn().mockResolvedValue({ error: mockUpdateError });
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'reception_scans') return createChain(mockScansData);
      if (table === 'hub_receptions') return createChain(mockReceptionData ? [mockReceptionData] : []);
      if (table === 'manifests') return createChain([]);
      return createChain([]);
    },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  }),
}));

vi.mock('@/lib/reception/reception-scan-validator', () => ({
  validateReceptionScan: vi.fn().mockResolvedValue({
    scanResult: 'received',
    packageId: 'pkg-1',
    packageLabel: 'CTN001',
  }),
}));

vi.mock('@/lib/pickup/audio', () => ({
  playFeedback: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useReceptionScans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScansData = [];
    mockInsertError = null;
    mockUpdateError = null;
    mockReceptionData = null;
  });

  it('fetches scan history for a reception', async () => {
    mockScansData = [
      {
        id: 'scan-1',
        barcode: 'CTN001',
        scan_result: 'received',
        scanned_at: '2026-03-18T10:00:00Z',
        package_id: 'pkg-1',
      },
    ];

    const { useReceptionScans } = await import('./useReceptionScans');
    const { result } = renderHook(
      () => useReceptionScans('rec-1', 'op-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].barcode).toBe('CTN001');
  });

  it('is disabled when receptionId is null', async () => {
    const { useReceptionScans } = await import('./useReceptionScans');
    const { result } = renderHook(
      () => useReceptionScans(null, 'op-1'),
      { wrapper: createWrapper() }
    );

    // Query should not fetch
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });
});

describe('useReceptionScanMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScansData = [];
    mockInsertError = null;
    mockUpdateError = null;
    mockReceptionData = { id: 'rec-1', status: 'pending', received_count: 0 };
  });

  it('inserts a scan record and plays feedback', async () => {
    const { useReceptionScanMutation } = await import('./useReceptionScans');
    const { playFeedback } = await import('@/lib/pickup/audio');

    const { result } = renderHook(
      () => useReceptionScanMutation(),
      { wrapper: createWrapper() }
    );

    result.current.mutate({
      barcode: 'CTN001',
      receptionId: 'rec-1',
      manifestId: 'manifest-1',
      operatorId: 'op-1',
      userId: 'user-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(playFeedback).toHaveBeenCalled();
  });
});
