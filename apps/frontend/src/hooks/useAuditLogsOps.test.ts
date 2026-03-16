import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuditLogsOps } from './useAuditLogsOps';

// ── mock ──────────────────────────────────────────────────────────────────────
//
// We build a single chainable builder object so every method returns `self`.
// Terminal `.range()` is a vi.fn() we can resolve per test.

const mockRange = vi.fn();
const mockOrder = vi.fn();
const mockIlike = vi.fn();
const mockOr = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();
const mockSelect = vi.fn();

// Each chain method returns a proxy that allows any further chaining.
// We build the chain lazily so it always points back to the same set of mocks.
function makeChain(): Record<string, (...args: unknown[]) => unknown> {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: (...args: unknown[]) => { mockSelect(...args); return chain; },
    eq:     (...args: unknown[]) => { mockEq(...args);     return chain; },
    gte:    (...args: unknown[]) => { mockGte(...args);    return chain; },
    lte:    (...args: unknown[]) => { mockLte(...args);    return chain; },
    ilike:  (...args: unknown[]) => { mockIlike(...args);  return chain; },
    or:     (...args: unknown[]) => { mockOr(...args);     return chain; },
    order:  (...args: unknown[]) => { mockOrder(...args);  return chain; },
    range:  (...args: unknown[]) => mockRange(...args),
  };
  return chain;
}

let chain: ReturnType<typeof makeChain>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'audit_logs') return chain;
      return {};
    },
  }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

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

const MOCK_LOG = {
  id: 'log-1',
  operator_id: 'op-1',
  user_id: 'user-1',
  action: 'UPDATE',
  resource_type: 'orders',
  resource_id: 'order-abc',
  changes_json: { before: { status: 'pending' }, after: { status: 'delivered' } },
  ip_address: '127.0.0.1',
  timestamp: '2026-03-16T10:00:00Z',
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useAuditLogsOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chain = makeChain();
  });

  it('is disabled when operatorId is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogsOps(null, {}), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns audit log entries on success', async () => {
    mockRange.mockResolvedValue({ data: [MOCK_LOG], error: null, count: 1 });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogsOps('op-1', {}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe('log-1');
    expect(result.current.data![0].action).toBe('UPDATE');
    expect(result.current.count).toBe(1);
  });

  it('always filters by operator_id', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-99', {}), { wrapper });

    await waitFor(() => expect(mockRange).toHaveBeenCalled());
    expect(mockEq).toHaveBeenCalledWith('operator_id', 'op-99');
  });

  it('returns empty data and count 0 when no logs', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogsOps('op-1', {}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.count).toBe(0);
  });

  it('returns null count when data is null', async () => {
    mockRange.mockResolvedValue({ data: null, error: null, count: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogsOps('op-1', {}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.count).toBeNull();
  });

  it('sets isError when query fails', async () => {
    mockRange.mockResolvedValue({ data: null, error: { message: 'DB error' }, count: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLogsOps('op-1', {}), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('applies pagination: page 2 with pageSize 10 uses correct range', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 25 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { page: 2, pageSize: 10 }), { wrapper });

    await waitFor(() => expect(mockRange).toHaveBeenCalled());
    // page 2 pageSize 10 → offset 10, end 19
    expect(mockRange).toHaveBeenCalledWith(10, 19);
  });

  it('applies userId filter', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { userId: 'user-42' }), { wrapper });

    await waitFor(() => expect(mockRange).toHaveBeenCalled());
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-42');
  });

  it('applies resourceType filter when not "all"', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { resourceType: 'orders' }), { wrapper });

    await waitFor(() => expect(mockRange).toHaveBeenCalled());
    expect(mockEq).toHaveBeenCalledWith('resource_type', 'orders');
  });

  it('does not apply resourceType filter when "all"', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { resourceType: 'all' }), { wrapper });

    await waitFor(() => expect(mockRange).toHaveBeenCalled());
    const eqCalls = mockEq.mock.calls.map(([col]) => col);
    expect(eqCalls).not.toContain('resource_type');
  });

  it('applies ilike search on resource_id when search provided', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { search: 'abc' }), { wrapper });

    await waitFor(() => expect(mockIlike).toHaveBeenCalled());
    expect(mockIlike).toHaveBeenCalledWith('resource_id', '%abc%');
  });

  it('orders by timestamp descending', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', {}), { wrapper });

    await waitFor(() => expect(mockOrder).toHaveBeenCalled());
    expect(mockOrder).toHaveBeenCalledWith('timestamp', { ascending: false });
  });

  it('applies actionType ilike filter when not ALL', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { actionType: 'INSERT' }), { wrapper });

    await waitFor(() => expect(mockIlike).toHaveBeenCalled());
    expect(mockIlike).toHaveBeenCalledWith('action', 'INSERT%');
  });

  it('does not apply actionType filter when ALL', async () => {
    mockRange.mockResolvedValue({ data: [], error: null, count: 0 });

    const { wrapper } = createWrapper();
    renderHook(() => useAuditLogsOps('op-1', { actionType: 'ALL' }), { wrapper });

    await waitFor(() => expect(mockRange).toHaveBeenCalled());
    expect(mockIlike).not.toHaveBeenCalled();
  });
});
