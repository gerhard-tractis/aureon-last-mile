import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Query chain (same shape as useAuditLogUsers.test.ts):
//   .from('users')
//   .select('id, full_name, role')
//   .eq('operator_id', ...)
//   .in('role', [...])
//   .is('deleted_at', null)
//   .order('full_name', { ascending: true })
// Terminal: .order()
const mockOrder = vi.fn();
const mockIs = vi.fn(() => ({ order: mockOrder }));
const mockIn = vi.fn(() => ({ is: mockIs }));
const mockEq = vi.fn(() => ({ in: mockIn }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

import { useCrewCandidates } from './useCrewCandidates';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const ME = 'user-me';
const ROWS = [
  { id: ME, full_name: 'Yo Mismo', role: 'pickup_leader' },
  { id: 'user-1', full_name: 'Ana Pérez', role: 'pickup_crew' },
  { id: 'user-2', full_name: 'Bruno Díaz', role: 'pickup_leader' },
];

describe('useCrewCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockIs.mockReturnValue({ order: mockOrder });
    mockIn.mockReturnValue({ is: mockIs });
    mockEq.mockReturnValue({ in: mockIn });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockImplementation((table: string) =>
      table === 'users' ? { select: mockSelect } : {},
    );
  });

  it('does not fetch when operatorId is null', () => {
    const { result } = renderHook(() => useCrewCandidates(null, ME), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('reads the operator directory, scoped to operator_id', async () => {
    renderHook(() => useCrewCandidates('op-99', ME), { wrapper: createWrapper() });
    await waitFor(() => expect(mockEq).toHaveBeenCalled());
    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockSelect).toHaveBeenCalledWith('id, full_name, role');
    // operator_id on every query — CLAUDE.md, non-negotiable.
    expect(mockEq).toHaveBeenCalledWith('operator_id', 'op-99');
  });

  // spec-66 — ops_leader is here because it both leads its own route and
  // rides on someone else's. Leaving it out would make an ops_leader unable
  // to lead OR join, which is the dead end spec-66 exists to remove.
  it('narrows to the roles that ride a van', async () => {
    renderHook(() => useCrewCandidates('op-1', ME), { wrapper: createWrapper() });
    await waitFor(() => expect(mockIn).toHaveBeenCalled());
    expect(mockIn).toHaveBeenCalledWith('role', [
      'pickup_crew',
      'pickup_leader',
      'ops_leader',
    ]);
  });

  it('excludes soft-deleted users and orders by name', async () => {
    renderHook(() => useCrewCandidates('op-1', ME), { wrapper: createWrapper() });
    await waitFor(() => expect(mockOrder).toHaveBeenCalled());
    expect(mockIs).toHaveBeenCalledWith('deleted_at', null);
    expect(mockOrder).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  // The fixture deliberately CONTAINS the signed-in user, so this fails the
  // moment the filter is dropped — it is not something the fixture grants.
  it('never offers the signed-in user as their own crew', async () => {
    mockOrder.mockResolvedValue({ data: ROWS, error: null });
    const { result } = renderHook(() => useCrewCandidates('op-1', ME), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((u) => u.id)).toEqual(['user-1', 'user-2']);
  });

  it('keeps everyone when there is no signed-in user to exclude', async () => {
    mockOrder.mockResolvedValue({ data: ROWS, error: null });
    const { result } = renderHook(() => useCrewCandidates('op-1', null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
  });

  it('throws the query error rather than reporting an empty roster', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const { result } = renderHook(() => useCrewCandidates('op-1', ME), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
