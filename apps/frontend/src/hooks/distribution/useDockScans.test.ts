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
const mockInsert = vi.fn();
const mockFrom = vi.fn();
const mockValidateDockScan = vi.fn();
const mockRecordDockVerification = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/distribution/dock-scan-validator', () => ({
  validateDockScan: (...args: unknown[]) => mockValidateDockScan(...args),
}));

vi.mock('@/lib/distribution/record-dock-verification', () => ({
  recordDockVerification: (...args: unknown[]) => mockRecordDockVerification(...args),
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

  // spec-39 Addendum 4. The scan was only ever writing dock_scans, so a scanned
  // CTN stayed indistinguishable from an untouched one in the pending list.
  describe('verification on scan', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
      mockInsert.mockResolvedValue({ error: null });
      mockRecordDockVerification.mockResolvedValue(undefined);
    });

    it('records a scan-sourced verification when the scan is accepted', async () => {
      mockValidateDockScan.mockResolvedValue({
        scanResult: 'accepted',
        packageId: 'pkg-1',
        packageLabel: 'PKG-001',
      });

      const { result } = renderHook(
        () => useDockScanMutation('op-1', 'batch-1', 'zone-1', 'user-1'),
        { wrapper }
      );
      await result.current.mutateAsync({ barcode: 'PKG-001' });

      expect(mockRecordDockVerification).toHaveBeenCalledWith({
        operatorId: 'op-1',
        packageId: 'pkg-1',
        userId: 'user-1',
        source: 'scan',
      });
    });

    it('does not verify a rejected scan', async () => {
      mockValidateDockScan.mockResolvedValue({
        scanResult: 'wrong_zone',
        packageId: 'pkg-1',
        packageLabel: 'PKG-001',
      });

      const { result } = renderHook(
        () => useDockScanMutation('op-1', 'batch-1', 'zone-1', 'user-1'),
        { wrapper }
      );
      await result.current.mutateAsync({ barcode: 'PKG-001' });

      expect(mockRecordDockVerification).not.toHaveBeenCalled();
    });

    it('does not verify when the barcode resolved to no package', async () => {
      mockValidateDockScan.mockResolvedValue({
        scanResult: 'accepted',
        packageId: null,
        packageLabel: null,
      });

      const { result } = renderHook(
        () => useDockScanMutation('op-1', 'batch-1', 'zone-1', 'user-1'),
        { wrapper }
      );
      await result.current.mutateAsync({ barcode: 'PKG-001' });

      expect(mockRecordDockVerification).not.toHaveBeenCalled();
    });

    // The dock_scans row is the record that matters. A verification that fails
    // should cost the crew a green chip, not the scan.
    it('still resolves the scan when the verification write fails', async () => {
      mockValidateDockScan.mockResolvedValue({
        scanResult: 'accepted',
        packageId: 'pkg-1',
        packageLabel: 'PKG-001',
      });
      mockRecordDockVerification.mockRejectedValue(new Error('rls denied'));

      const { result } = renderHook(
        () => useDockScanMutation('op-1', 'batch-1', 'zone-1', 'user-1'),
        { wrapper }
      );

      await expect(
        result.current.mutateAsync({ barcode: 'PKG-001' })
      ).resolves.toMatchObject({ scanResult: 'accepted' });
    });
  });
});
