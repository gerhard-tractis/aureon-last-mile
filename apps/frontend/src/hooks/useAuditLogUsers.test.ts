import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuditLogUsers } from './useAuditLogUsers';

// ── mock chain builders ──────────────────────────────────────────────────────

// Query chain:
//   .from('users')
//   .select('id, email, full_name')
//   .eq('operator_id', ...)
//   .is('deleted_at', null)
//   .order('full_name', { ascending: true })
// Terminal: .order()

const mockOrder = vi.fn();
const mockIs = vi.fn(() => ({ order: mockOrder }));
const mockEq = vi.fn(() => ({ is: mockIs }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'users') return { select: mockSelect };
      return {};
    },
  }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

const MOCK_USERS = [
  { id: 'user-1', email: 'ana@example.com', full_name: 'Ana García' },
  { id: 'user-2', email: 'bob@example.com', full_name: 'Bob Martínez' },
];

// ── tests ────────────────────────────────────────────────────────────────────

describe('useAuditLogUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockReturnValue(undefined);
    mockIs.mockReturnValue({ order: mockOrder });
    mockEq.mockReturnValue({ is: mockIs });
    mockSelect.mockReturnValue({ eq: mockEq });
  });

  it('is disabled when operatorId is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogUsers(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns users list on success', async () => {
    mockOrder.mockResolvedValue({ data: MOCK_USERS, error: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].id).toBe('user-1');
    expect(result.current.data![0].full_name).toBe('Ana García');
    expect(result.current.data![0].email).toBe('ana@example.com');
  });

  it('filters by operator_id', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogUsers('op-99'), { wrapper });

    await waitFor(() => expect(mockEq).toHaveBeenCalled());
    expect(mockEq).toHaveBeenCalledWith('operator_id', 'op-99');
  });

  it('filters deleted_at IS NULL', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(mockIs).toHaveBeenCalled());
    expect(mockIs).toHaveBeenCalledWith('deleted_at', null);
  });

  it('selects only id, email, full_name', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(mockSelect).toHaveBeenCalled());
    expect(mockSelect).toHaveBeenCalledWith('id, email, full_name');
  });

  it('orders by full_name ascending', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(mockOrder).toHaveBeenCalled());
    expect(mockOrder).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  it('returns empty array when no users', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    mockOrder.mockResolvedValue({ data: null, error: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('sets isError when query fails', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogUsers('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
