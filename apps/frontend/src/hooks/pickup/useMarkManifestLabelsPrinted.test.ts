import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useMarkManifestLabelsPrinted } from './useMarkManifestLabelsPrinted';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useMarkManifestLabelsPrinted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes mark_manifest_labels_printed with the manifest id', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useMarkManifestLabelsPrinted(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ manifestId: 'm-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('mark_manifest_labels_printed', { p_manifest_id: 'm-1' });
  });

  it('surfaces an error from the RPC', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'manifest not found' } });

    const { result } = renderHook(() => useMarkManifestLabelsPrinted(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ manifestId: 'm-1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/not found/i);
  });
});
