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

const capturedCallbacks: Record<string, RealtimeCallback[]> = {};
const mockRemoveChannel = vi.fn();

function makeChannelMock(name: string) {
  const channelObj: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  } = {
    on: vi.fn((_event: string, _filter: unknown, cb: RealtimeCallback) => {
      if (!capturedCallbacks[name]) capturedCallbacks[name] = [];
      capturedCallbacks[name].push(cb);
      return channelObj;
    }),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
  return channelObj;
}

const mockChannel = vi.fn((name: string) => makeChannelMock(name));

// RPC returns the same shape as the Postgres function
const mockRpcData = {
  orders: [
    { id: 'order-1', operator_id: 'op-abc', status: 'en_bodega', deleted_at: null },
    { id: 'order-2', operator_id: 'op-abc', status: 'en_ruta', deleted_at: null },
  ],
  routes: [{ id: 'route-1', operator_id: 'op-abc', status: 'in_progress' }],
  manifests: [{ id: 'manifest-1', operator_id: 'op-abc', status: 'pending' }],
  sla_config: [{ id: 'sla-1', operator_id: 'op-abc' }],
};

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    rpc: vi.fn(() => Promise.resolve({ data: mockRpcData, error: null })),
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  }),
}));

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
    for (const key of Object.keys(capturedCallbacks)) {
      delete capturedCallbacks[key];
    }
    mockChannel.mockImplementation((name: string) => makeChannelMock(name));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isLoading: true initially, false after RPC resolves', async () => {
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

  it('maps RPC response to snapshot shape', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.snapshot?.orders).toHaveLength(2);
    expect(result.current.snapshot?.routes).toHaveLength(1);
    expect(result.current.snapshot?.pickups).toHaveLength(1); // mapped from manifests
    expect(result.current.snapshot?.returns).toHaveLength(0); // hardcoded empty
    expect(result.current.snapshot?.retailerSlaConfig).toHaveLength(1);
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

  it('merges updated order via Realtime UPDATE', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const channelName = Object.keys(capturedCallbacks).find(k => k.includes('order'));
    expect(channelName).toBeDefined();

    act(() => {
      capturedCallbacks[channelName!][0]({
        eventType: 'UPDATE',
        new: { id: 'order-1', operator_id: 'op-abc', status: 'asignado', deleted_at: null },
        old: { id: 'order-1' },
      });
    });

    await waitFor(() => {
      const orders = result.current.snapshot?.orders ?? [];
      const found = orders.find((o) => (o as { id: string }).id === 'order-1');
      expect((found as { status: string } | undefined)?.status).toBe('asignado');
    });
  });

  it('removes order from snapshot when it transitions to entregado', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.snapshot?.orders).toHaveLength(2);

    const channelName = Object.keys(capturedCallbacks).find(k => k.includes('order'));

    act(() => {
      capturedCallbacks[channelName!][0]({
        eventType: 'UPDATE',
        new: { id: 'order-1', operator_id: 'op-abc', status: 'entregado', deleted_at: null },
        old: { id: 'order-1' },
      });
    });

    await waitFor(() => {
      expect(result.current.snapshot?.orders).toHaveLength(1);
    });
  });

  it('subscribes to Realtime channels for orders and routes', async () => {
    const { result } = renderHook(() => useOpsControlSnapshot('op-abc'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const channelNames = mockChannel.mock.calls.map(c => c[0] as string);
    expect(channelNames.some(n => n.includes('order'))).toBe(true);
    expect(channelNames.some(n => n.includes('route'))).toBe(true);
    expect(channelNames).toHaveLength(2);
  });
});
