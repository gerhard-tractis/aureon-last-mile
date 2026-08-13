import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useScanMutation } from './usePickupScans';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ error: null });

// spec-52 Task 2b: the client no longer writes packages.status directly. The
// SECURITY DEFINER trigger `trg_pickup_scan_advance_status` (Task 2, commit
// 5ec592b) advances a package to 'verificado' off the pickup_scans insert
// below, gated by the forward-only guard spec52_may_advance_status(). Track
// every table the mocked client is asked for so we can assert 'packages' is
// never touched from here — otherwise the guard is inert: it refuses the
// promotion, then the client would perform it one statement later.
const fromCalls: string[] = [];

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      if (table === 'pickup_scans') {
        return { insert: mockInsert };
      }
      return {};
    },
  }),
}));

vi.mock('@/lib/pickup/scan-validator', () => ({
  validateScan: vi.fn(),
}));

vi.mock('@/lib/pickup/audio', () => ({
  playFeedback: vi.fn(),
}));

import { validateScan } from '@/lib/pickup/scan-validator';

const mockValidateScan = vi.mocked(validateScan);

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const baseInput = {
  barcode: 'PKG-001',
  manifestId: 'manifest-1',
  operatorId: 'op-1',
  externalLoadId: 'load-1',
  userId: 'user-1',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useScanMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCalls.length = 0;
    mockInsert.mockResolvedValue({ error: null });
  });

  it('inserts a pickup_scans row on single verified scan and never touches packages', async () => {
    mockValidateScan.mockResolvedValue({
      scanResult: 'verified',
      packageId: 'pkg-1',
      packageIds: ['pkg-1'],
      packageLabel: 'PKG-001',
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: 'pkg-1',
        scan_result: 'verified',
      })
    );
    // The DB trigger trg_pickup_scan_advance_status owns the status
    // advancement now — the client must never issue a packages write.
    expect(fromCalls).not.toContain('packages');
  });

  it('inserts a pickup_scans row per package on order-number scan and never touches packages', async () => {
    mockValidateScan.mockResolvedValue({
      scanResult: 'verified',
      packageId: 'pkg-1',
      packageIds: ['pkg-1', 'pkg-2', 'pkg-3'],
      packageLabel: 'PKG-001',
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({ package_id: 'pkg-1', scan_result: 'verified' }),
      expect.objectContaining({ package_id: 'pkg-2', scan_result: 'verified' }),
      expect.objectContaining({ package_id: 'pkg-3', scan_result: 'verified' }),
    ]);
    expect(fromCalls).not.toContain('packages');
  });

  it('does NOT touch packages on duplicate scan', async () => {
    mockValidateScan.mockResolvedValue({
      scanResult: 'duplicate',
      packageId: 'pkg-1',
      packageIds: [],
      packageLabel: 'PKG-001',
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromCalls).not.toContain('packages');
  });

  it('does NOT touch packages on not_found scan', async () => {
    mockValidateScan.mockResolvedValue({
      scanResult: 'not_found',
      packageId: null,
      packageIds: [],
      packageLabel: null,
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromCalls).not.toContain('packages');
  });
});
