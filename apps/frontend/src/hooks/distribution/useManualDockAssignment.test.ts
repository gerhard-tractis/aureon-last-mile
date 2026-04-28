import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useManualDockAssignment } from './useManualDockAssignment';
import { UserRole } from '@/lib/types/auth.types';

const mockInsert = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

let mockRole: string | null = UserRole.WAREHOUSE_STAFF;

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ role: mockRole }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ insert: mockInsert });
  mockInsert.mockResolvedValue({ data: null, error: null });
  mockRole = UserRole.WAREHOUSE_STAFF;
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children
  );

describe('useManualDockAssignment.canUse', () => {
  it('is false for warehouse_staff', () => {
    mockRole = UserRole.WAREHOUSE_STAFF;
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    expect(result.current.canUse).toBe(false);
  });

  it('is false for pickup_crew', () => {
    mockRole = UserRole.PICKUP_CREW;
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    expect(result.current.canUse).toBe(false);
  });

  it('is false for loading_crew', () => {
    mockRole = UserRole.LOADING_CREW;
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    expect(result.current.canUse).toBe(false);
  });

  it('is true for operations_manager', () => {
    mockRole = UserRole.OPERATIONS_MANAGER;
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    expect(result.current.canUse).toBe(true);
  });

  it('is true for admin', () => {
    mockRole = UserRole.ADMIN;
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    expect(result.current.canUse).toBe(true);
  });
});

describe('useManualDockAssignment.mutateAsync', () => {
  beforeEach(() => {
    mockRole = UserRole.OPERATIONS_MANAGER;
  });

  it('inserts a dock_scans row with manual_override = true and no redirect_reason for an anden zone', async () => {
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    await result.current.mutateAsync({
      packageId: 'pkg-1',
      zoneId: 'zone-anden',
      barcode: 'PKG-001',
      isConsolidation: false,
    });
    await waitFor(() => expect(mockInsert).toHaveBeenCalled());
    expect(mockFrom).toHaveBeenCalledWith('dock_scans');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        package_id: 'pkg-1',
        manual_override: true,
        scanned_by: 'user-1',
      })
    );
    const args = mockInsert.mock.calls[0][0];
    expect(args.redirect_reason ?? null).toBeNull();
  });

  it('sets redirect_reason = manual_consolidation when target is consolidación', async () => {
    const { result } = renderHook(
      () => useManualDockAssignment('op-1', 'user-1'),
      { wrapper }
    );
    await result.current.mutateAsync({
      packageId: 'pkg-1',
      zoneId: 'zone-cons',
      barcode: 'PKG-001',
      isConsolidation: true,
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        manual_override: true,
        redirect_reason: 'manual_consolidation',
      })
    );
  });
});
