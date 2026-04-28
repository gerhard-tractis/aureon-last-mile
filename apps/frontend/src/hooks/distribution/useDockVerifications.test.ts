import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useDockVerifications,
  useDockVerificationMutation,
} from './useDockVerifications';

const mockOrder = vi.fn();
const mockGte = vi.fn();
const mockLt = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockFrom = vi.fn();
const mockChannel = vi.fn();
const mockSubscribe = vi.fn();
const mockOn = vi.fn();
const mockRemoveChannel = vi.fn();

const mockSupabase = {
  from: mockFrom,
  channel: mockChannel,
  removeChannel: mockRemoveChannel,
};

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/pickup/audio', () => ({
  playFeedback: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs, gte: mockGte });
  mockIs.mockReturnValue({ eq: mockEq, gte: mockGte, order: mockOrder });
  mockGte.mockReturnValue({ lt: mockLt, is: mockIs, order: mockOrder });
  mockLt.mockReturnValue({ is: mockIs, order: mockOrder });
  mockOrder.mockResolvedValue({ data: [], error: null });
  mockInsert.mockResolvedValue({ data: null, error: null });
  mockChannel.mockReturnValue({ on: mockOn });
  mockOn.mockReturnValue({ subscribe: mockSubscribe });
  mockSubscribe.mockReturnValue({ unsubscribe: vi.fn() });
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children
  );

describe('useDockVerifications', () => {
  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useDockVerifications(null, '2026-04-28'), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns an empty Set when no verifications exist', async () => {
    const { result } = renderHook(
      () => useDockVerifications('op-1', '2026-04-28'),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeInstanceOf(Set);
    expect(result.current.data!.size).toBe(0);
  });

  it('returns a Set of package_ids when verifications exist', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { package_id: 'pkg-1' },
        { package_id: 'pkg-2' },
        { package_id: 'pkg-1' }, // duplicate id ignored by Set
      ],
      error: null,
    });
    const { result } = renderHook(
      () => useDockVerifications('op-1', '2026-04-28'),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.has('pkg-1')).toBe(true);
    expect(result.current.data!.has('pkg-2')).toBe(true);
    expect(result.current.data!.size).toBe(2);
  });

  it('subscribes to the dock_verifications realtime channel scoped by operator_id', async () => {
    renderHook(() => useDockVerifications('op-1', '2026-04-28'), { wrapper });
    await waitFor(() => expect(mockChannel).toHaveBeenCalled());
    expect(mockChannel.mock.calls[0][0]).toMatch(/dock-verifications.*op-1/);
    expect(mockOn).toHaveBeenCalled();
    expect(mockSubscribe).toHaveBeenCalled();
  });
});

describe('useDockVerificationMutation', () => {
  it('returns a mutation function', () => {
    const { result } = renderHook(
      () => useDockVerificationMutation('op-1', 'user-1'),
      { wrapper }
    );
    expect(typeof result.current.mutate).toBe('function');
  });

  it('inserts a dock_verifications row with the given source', async () => {
    const { result } = renderHook(
      () => useDockVerificationMutation('op-1', 'user-1'),
      { wrapper }
    );
    await result.current.mutateAsync({ packageId: 'pkg-1', source: 'tap' });
    expect(mockFrom).toHaveBeenCalledWith('dock_verifications');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        package_id: 'pkg-1',
        verified_by: 'user-1',
        source: 'tap',
      })
    );
  });

  it('records source=scan when called with scan source', async () => {
    const { result } = renderHook(
      () => useDockVerificationMutation('op-1', 'user-1'),
      { wrapper }
    );
    await result.current.mutateAsync({ packageId: 'pkg-2', source: 'scan' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'scan', package_id: 'pkg-2' })
    );
  });

  it('treats unique-violation errors as no-ops (idempotent re-verify)', async () => {
    mockInsert.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const { result } = renderHook(
      () => useDockVerificationMutation('op-1', 'user-1'),
      { wrapper }
    );
    await expect(
      result.current.mutateAsync({ packageId: 'pkg-1', source: 'tap' })
    ).resolves.toBeDefined();
  });

  it('throws on non-unique-violation errors', async () => {
    mockInsert.mockResolvedValueOnce({
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    });
    const { result } = renderHook(
      () => useDockVerificationMutation('op-1', 'user-1'),
      { wrapper }
    );
    await expect(
      result.current.mutateAsync({ packageId: 'pkg-1', source: 'tap' })
    ).rejects.toBeTruthy();
  });
});
