import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ModuleKey } from '@/lib/modules/registry';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useEnabledModules, useModuleEnabled } from './useEnabledModules';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useEnabledModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useEnabledModules(null), { wrapper: wrapperFactory() });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('filters out unknown module keys and returns valid ones', async () => {
    mockRpc.mockResolvedValue({ data: ['pickup', 'package_labels', 'not_a_real_module'], error: null });
    const { result } = renderHook(() => useEnabledModules('op-1'), { wrapper: wrapperFactory() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([ModuleKey.PICKUP, ModuleKey.PACKAGE_LABELS]);
  });
});

describe('useModuleEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when the key is in the enabled set', async () => {
    mockRpc.mockResolvedValue({ data: ['package_labels'], error: null });
    const { result } = renderHook(
      () => useModuleEnabled('op-1', ModuleKey.PACKAGE_LABELS),
      { wrapper: wrapperFactory() },
    );
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false when the key is not enabled', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () => useModuleEnabled('op-1', ModuleKey.PACKAGE_LABELS),
      { wrapper: wrapperFactory() },
    );
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
