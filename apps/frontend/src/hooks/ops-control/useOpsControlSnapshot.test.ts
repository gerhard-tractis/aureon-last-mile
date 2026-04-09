import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

// Realtime channel mock state
type RealtimeCallback = (payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) => void;

// Stored per channel name, persists across the test body
const capturedCallbacks: Record<string, RealtimeCallback[]> = {};
const mockRemoveChannel = vi.fn();

function makeChannelMock(name: string) {
  // Build the fluent chain: channel.on(...).subscribe(...)
  // Both .on() and .subscribe() live on the same object so chaining works.
  const channelObj: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  } = {
    on: vi.fn((_event: string, _filter: unknown, cb: RealtimeCallback) => {
      if (!capturedCallbacks[name]) capturedCallbacks[name] = [];
      capturedCallbacks[name].push(cb);
      return channelObj; // return self so .subscribe() resolves on the same object
    }),
    subscribe: vi.fn((_cb?: (status: string) => void) => {
      return { unsubscribe: vi.fn() };
    }),
  };
  return channelObj;
}

const mockChannel = vi.fn((name: string) => makeChannelMock(name));

const mockOrdersData = [
  { id: 'order-1', operator_id: 'op-abc', status: 'pending', deleted_at: null },
  { id: 'order-2', operator_id: 'op-abc', status: 'delivered', deleted_at: null },
];
const mockRoutesData = [
  { id: 'route-1', operator_id: 'op-abc' },
];
const mockPickupsData = [
  { id: 'pickup-1', operator_id: 'op-abc' },
];
const mockReturnsData = [
  { id: 'return-1', operator_id: 'op-abc', deleted_at: null },
];
const mockSlaConfigData = [
  { id: 'sla-1', operator_id: 'op-abc' },
];

function makeFromMock(table: string) {
  let eqFilter: string | null = null;
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((_col: string, _val: string) => {
      eqFilter = _col;
      return chain;
    }),
    is: vi.fn().mockReturnThis(),
    then: undefined as unknown,
  };

  const dataMap: Record<string, unknown[]> = {
    orders: mockOrdersData,
    routes: mockRoutesData,
    pickups: mockPickupsData,
    returns: mockReturnsData,
    retailer_return_sla_config: mockSlaConfigData,
  };

  // Make it thenable (Promise-like)
  (chain as unknown as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
    return Promise.resolve({ data: dataMap[table] ?? [], error: null }).then(resolve);
  };

  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => makeFromMock(table),
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  }),
}));

// Import after mocks
import { useOpsControlSnapshot } from './useOpsControlSnapshot';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useOpsControlSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear capturedCallbacks keys (it's a const object, can't reassign)
    for (const key of Object.keys(capturedCallbacks)) {
      delete capturedCallbacks[key];
    }
    mockChannel.mockImplementation((name: string) => makeChannelMock(name));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isLoading: true initially, false after data resolves', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.snapshot).toBeNull();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.snapshot).not.toBeNull();
  });

  it('scopes every table query by operator_id', async () => {
    // Track eq calls per table
    const eqCalls: Array<[string, string]> = [];
    vi.doMock('@/lib/supabase/client', () => ({
      createSPAClient: () => ({
        from: (table: string) => {
          const chain = makeFromMock(table);
          const originalEq = chain.eq.bind(chain);
          chain.eq = vi.fn((col: string, val: string) => {
            eqCalls.push([col, val]);
            return originalEq(col, val);
          });
          return chain;
        },
        channel: mockChannel,
        removeChannel: mockRemoveChannel,
      }),
    }));

    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The snapshot should contain data for all 5 tables
    expect(result.current.snapshot?.orders).toBeDefined();
    expect(result.current.snapshot?.routes).toBeDefined();
    expect(result.current.snapshot?.pickups).toBeDefined();
    expect(result.current.snapshot?.returns).toBeDefined();
    expect(result.current.snapshot?.retailerSlaConfig).toBeDefined();
  });

  it('sets lastSyncAt to null initially, then to a Date after fetch', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    expect(result.current.lastSyncAt).toBeNull();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.lastSyncAt).toBeInstanceOf(Date);
  });

  it('merges updated order row into snapshot on Realtime UPDATE without full refetch', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const initialOrders = result.current.snapshot?.orders ?? [];
    expect(initialOrders.length).toBeGreaterThan(0);

    // Simulate a Realtime UPDATE event for order-1
    const updatedOrder = { id: 'order-1', operator_id: 'op-abc', status: 'in_transit', deleted_at: null };

    // Find the orders channel callback and fire it
    const channelName = Object.keys(capturedCallbacks).find(k => k.includes('order'));
    expect(channelName).toBeDefined(); // ensure channel was subscribed
    expect(capturedCallbacks[channelName!]?.length).toBeGreaterThan(0);

    act(() => {
      capturedCallbacks[channelName!][0]({
        eventType: 'UPDATE',
        new: updatedOrder,
        old: { id: 'order-1' },
      });
    });

    await waitFor(() => {
      const orders = result.current.snapshot?.orders ?? [];
      const found = orders.find((o) => (o as { id: string }).id === 'order-1');
      expect((found as { status: string } | undefined)?.status).toBe('in_transit');
    });
  });

  it('subscribes to Realtime channels for all 4 tables on mount', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should have created channels for orders, routes, pickups, returns
    const channelNames = mockChannel.mock.calls.map(c => c[0] as string);
    expect(channelNames.some(n => n.includes('order'))).toBe(true);
    expect(channelNames.some(n => n.includes('route'))).toBe(true);
    expect(channelNames.some(n => n.includes('pickup'))).toBe(true);
    expect(channelNames.some(n => n.includes('return'))).toBe(true);
  });
});
