import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMissingPackages, useDiscrepancyNotes, useSaveDiscrepancyNote } from './useDiscrepancies';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

// ── useMissingPackages ────────────────────────────────────────────────────────

describe('useMissingPackages', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(
      () => useMissingPackages(null, 'load-1', 'manifest-1'),
      { wrapper: wrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when externalLoadId is null', () => {
    const { result } = renderHook(
      () => useMissingPackages('op-1', null, 'manifest-1'),
      { wrapper: wrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when manifestId is null', () => {
    const { result } = renderHook(
      () => useMissingPackages('op-1', 'load-1', null),
      { wrapper: wrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns missing packages (not in verified scans)', async () => {
    // pickup_scans → returns pkg-2 as verified
    const scansChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [{ package_id: 'pkg-2' }], error: null }),
    };
    // orders query
    const ordersChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [{ id: 'order-1', order_number: 'ORD-001' }], error: null }),
    };
    // packages query → pkg-1 and pkg-2
    const packagesChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [
          { id: 'pkg-1', label: 'PKG-001', order_id: 'order-1' },
          { id: 'pkg-2', label: 'PKG-002', order_id: 'order-1' },
        ],
        error: null,
      }),
    };

    mockFrom
      .mockReturnValueOnce(scansChain)
      .mockReturnValueOnce(ordersChain)
      .mockReturnValueOnce(packagesChain);

    const { result } = renderHook(
      () => useMissingPackages('op-1', 'load-1', 'manifest-1'),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // pkg-1 is missing (not verified), pkg-2 is verified
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({ id: 'pkg-1', label: 'PKG-001', order_number: 'ORD-001' });
  });
});

// ── useDiscrepancyNotes ───────────────────────────────────────────────────────

describe('useDiscrepancyNotes', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when manifestId is null', () => {
    const { result } = renderHook(() => useDiscrepancyNotes(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns discrepancy notes on success', async () => {
    const notes = [{ id: 'note-1', package_id: 'pkg-1', note: 'Damaged box' }];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: notes, error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useDiscrepancyNotes('manifest-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].note).toBe('Damaged box');
  });

  it('exposes isError on Supabase failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useDiscrepancyNotes('manifest-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useSaveDiscrepancyNote ────────────────────────────────────────────────────

describe('useSaveDiscrepancyNote', () => {
  beforeEach(() => mockFrom.mockReset());

  it('inserts a new note when none exists', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'discrepancy_notes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
          insert: insertMock,
        };
      }
    });

    const { result } = renderHook(() => useSaveDiscrepancyNote(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        operatorId: 'op-1',
        manifestId: 'manifest-1',
        packageId: 'pkg-1',
        note: 'Missing item',
        userId: 'user-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it('updates existing note when one already exists', async () => {
    const eqForUpdateMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqForUpdateMock });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'discrepancy_notes') {
        callCount++;
        if (callCount === 1) {
          // select existing
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [{ id: 'note-1' }], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        // update existing
        return { update: updateMock };
      }
    });

    const { result } = renderHook(() => useSaveDiscrepancyNote(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        operatorId: 'op-1',
        manifestId: 'manifest-1',
        packageId: 'pkg-1',
        note: 'Updated note',
        userId: 'user-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateMock).toHaveBeenCalledWith({ note: 'Updated note' });
  });
});
