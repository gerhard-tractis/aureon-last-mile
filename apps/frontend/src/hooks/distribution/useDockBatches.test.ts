// apps/frontend/src/hooks/distribution/useDockBatches.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDockBatch, useCreateDockBatch, useCloseDockBatch } from './useDockBatches';

const mockSupabase = {
  from: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, {
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }, children);

describe('useDockBatch', () => {
  it('is disabled when batchId is null', () => {
    const { result } = renderHook(() => useDockBatch(null, 'op-1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useDockBatch('batch-1', null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when both are null', () => {
    const { result } = renderHook(() => useDockBatch(null, null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateDockBatch', () => {
  it('returns a mutation function', () => {
    const { result } = renderHook(() => useCreateDockBatch(), { wrapper });
    expect(typeof result.current.mutate).toBe('function');
    expect(typeof result.current.mutateAsync).toBe('function');
  });

  it('is not loading initially', () => {
    const { result } = renderHook(() => useCreateDockBatch(), { wrapper });
    expect(result.current.isPending).toBe(false);
  });
});

describe('useCloseDockBatch', () => {
  it('returns a mutation function', () => {
    const { result } = renderHook(() => useCloseDockBatch(), { wrapper });
    expect(typeof result.current.mutate).toBe('function');
  });

  it('is not loading initially', () => {
    const { result } = renderHook(() => useCloseDockBatch(), { wrapper });
    expect(result.current.isPending).toBe(false);
  });
});
