import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRedirectBatchScanToConsolidation } from './useRedirectBatchScan';

const mockEq = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ update: mockUpdate });
  mockUpdate.mockReturnValue({ eq: mockEq });
  // .eq() returns a thenable that ALSO has another .eq() so chains of any length resolve.
  const chain = {
    eq: mockEq,
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(onFulfilled),
  };
  mockEq.mockReturnValue(chain);
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children
  );

describe('useRedirectBatchScanToConsolidation', () => {
  it('exposes a mutateAsync function', () => {
    const { result } = renderHook(
      () => useRedirectBatchScanToConsolidation('op-1', 'batch-1'),
      { wrapper }
    );
    expect(typeof result.current.mutateAsync).toBe('function');
  });

  it('updates the dock_scans row, the package, and the batch counter', async () => {
    const { result } = renderHook(
      () => useRedirectBatchScanToConsolidation('op-1', 'batch-1'),
      { wrapper }
    );
    await result.current.mutateAsync({
      scanId: 'scan-1',
      packageId: 'pkg-1',
      consolidationZoneId: 'zone-cons',
      previousPackageCount: 5,
    });

    const tablesUpdated = mockFrom.mock.calls.map(c => c[0]);
    expect(tablesUpdated).toEqual(
      expect.arrayContaining(['dock_scans', 'packages', 'dock_batches'])
    );

    // Find which update call modified packages
    const updateCalls = mockUpdate.mock.calls.map(c => c[0]);
    const packageUpdate = updateCalls.find(
      (u: Record<string, unknown>) => u.dock_zone_id === 'zone-cons'
    );
    expect(packageUpdate).toEqual(
      expect.objectContaining({ status: 'retenido', dock_zone_id: 'zone-cons' })
    );

    const scanUpdate = updateCalls.find(
      (u: Record<string, unknown>) => u.redirect_reason === 'manual_consolidation'
    );
    expect(scanUpdate).toBeDefined();

    const batchUpdate = updateCalls.find(
      (u: Record<string, unknown>) => 'package_count' in u
    );
    expect(batchUpdate).toEqual(expect.objectContaining({ package_count: 4 }));
  });

  it('does not let package_count go below zero', async () => {
    const { result } = renderHook(
      () => useRedirectBatchScanToConsolidation('op-1', 'batch-1'),
      { wrapper }
    );
    await result.current.mutateAsync({
      scanId: 'scan-1',
      packageId: 'pkg-1',
      consolidationZoneId: 'zone-cons',
      previousPackageCount: 0,
    });
    const updateCalls = mockUpdate.mock.calls.map(c => c[0]);
    const batchUpdate = updateCalls.find(
      (u: Record<string, unknown>) => 'package_count' in u
    );
    expect(batchUpdate).toEqual(expect.objectContaining({ package_count: 0 }));
  });
});
