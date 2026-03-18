import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useScanMutation } from './usePickupScans';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();

// Chain: .update().eq().in() or .update().eq().eq()
function createUpdateChain() {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ error: null }),
  };
  mockUpdate.mockReturnValue(chain);
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'pickup_scans') {
        return { insert: mockInsert };
      }
      if (table === 'packages') {
        return { update: mockUpdate };
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
    mockInsert.mockResolvedValue({ error: null });
  });

  it('updates package status to verificado on single verified scan', async () => {
    const updateChain = createUpdateChain();
    mockValidateScan.mockResolvedValue({
      scanResult: 'verified',
      packageId: 'pkg-1',
      packageIds: ['pkg-1'],
      packageLabel: 'PKG-001',
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should have called update on packages table
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'verificado',
      status_updated_at: expect.any(String),
    });
    // Should filter by the package IDs
    expect(updateChain.in).toHaveBeenCalledWith('id', ['pkg-1']);
  });

  it('updates multiple packages to verificado on order-number scan', async () => {
    const updateChain = createUpdateChain();
    mockValidateScan.mockResolvedValue({
      scanResult: 'verified',
      packageId: 'pkg-1',
      packageIds: ['pkg-1', 'pkg-2', 'pkg-3'],
      packageLabel: 'PKG-001',
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'verificado',
      status_updated_at: expect.any(String),
    });
    expect(updateChain.in).toHaveBeenCalledWith('id', ['pkg-1', 'pkg-2', 'pkg-3']);
  });

  it('does NOT update package status on duplicate scan', async () => {
    createUpdateChain();
    mockValidateScan.mockResolvedValue({
      scanResult: 'duplicate',
      packageId: 'pkg-1',
      packageIds: [],
      packageLabel: 'PKG-001',
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does NOT update package status on not_found scan', async () => {
    createUpdateChain();
    mockValidateScan.mockResolvedValue({
      scanResult: 'not_found',
      packageId: null,
      packageIds: [],
      packageLabel: null,
    });

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate(baseInput);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
