// apps/frontend/src/hooks/distribution/useDockScans.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDockScans, useDockScanMutation } from './useDockScans';

const mockOrder = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/distribution/dock-scan-validator', () => ({
  validateDockScan: vi.fn(),
}));

vi.mock('@/lib/pickup/audio', () => ({
  playFeedback: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs });
  mockIs.mockReturnValue({ order: mockOrder });
  mockOrder.mockResolvedValue({ data: [], error: null });
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, {
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }, children);

describe('useDockScans', () => {
  it('is disabled when batchId is null', () => {
    const { result } = renderHook(() => useDockScans(null, 'op-1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useDockScans('batch-1', null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns empty array when no scans', async () => {
    const { result } = renderHook(() => useDockScans('batch-1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns scan records when data exists', async () => {
    const scans = [
      { id: 's1', barcode: 'PKG-001', scan_result: 'accepted', scanned_at: '2026-03-18T10:00:00Z', package_id: 'p1' },
    ];
    mockOrder.mockResolvedValue({ data: scans, error: null });
    const { result } = renderHook(() => useDockScans('batch-1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].barcode).toBe('PKG-001');
  });
});

describe('useDockScanMutation', () => {
  it('returns a mutation function', () => {
    const { result } = renderHook(
      () => useDockScanMutation('op-1', 'batch-1', 'zone-1', 'user-1'),
      { wrapper }
    );
    expect(typeof result.current.mutate).toBe('function');
  });

  it('is not loading initially', () => {
    const { result } = renderHook(
      () => useDockScanMutation('op-1', 'batch-1', 'zone-1', 'user-1'),
      { wrapper }
    );
    expect(result.current.isPending).toBe(false);
  });
});
