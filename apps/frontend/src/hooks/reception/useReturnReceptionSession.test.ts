import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockSessionRpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let mockScanRpcResult: { data: unknown; error: unknown } = { data: null, error: null };

let packagesQueue: unknown[][] = [[]];
let dispatchesQueue: unknown[][] = [[]];
let routesQueue: unknown[][] = [[]];
let scansRows: unknown[] = [];

let packagesCallCount = 0;
let dispatchesCallCount = 0;
let routesCallCount = 0;

const scanInsertSpy = vi.fn();

function makeChain(rows: unknown[]) {
  const resolved = Promise.resolve({ data: rows, error: null });
  const chain: Record<string, unknown> = {
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'neq', 'or', 'not', 'match']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['single'] = vi.fn().mockResolvedValue({
    data: rows[0] ?? null,
    error: rows.length ? null : { code: 'PGRST116' },
  });
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'packages') {
        const idx = Math.min(packagesCallCount++, packagesQueue.length - 1);
        return makeChain(packagesQueue[idx]);
      }
      if (table === 'dispatches') {
        const idx = Math.min(dispatchesCallCount++, dispatchesQueue.length - 1);
        return makeChain(dispatchesQueue[idx]);
      }
      if (table === 'routes') {
        const idx = Math.min(routesCallCount++, routesQueue.length - 1);
        return makeChain(routesQueue[idx]);
      }
      if (table === 'return_reception_scans') {
        const base = makeChain(scansRows);
        (base as Record<string, unknown>)['insert'] = vi.fn((row) => {
          scanInsertSpy(row);
          return Promise.resolve({ error: null });
        });
        return base;
      }
      return makeChain([]);
    },

    rpc: vi.fn((name: string) => {
      if (name === 'find_or_create_return_reception') return Promise.resolve(mockSessionRpcResult);
      if (name === 'complete_return_reception_scan') return Promise.resolve(mockScanRpcResult);
      return Promise.resolve({ data: null, error: null });
    }),

    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },

    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    })),
    removeChannel: vi.fn(),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const BASE_OPTS = { operatorId: 'op-1', externalRouteId: 'RUTA-001' };

const VALID_SESSION = {
  id: 'sess-1',
  operator_id: 'op-1',
  external_route_id: 'RUTA-001',
  status: 'in_progress',
  expected_count: 1,
  received_count: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useReturnReceptionSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    packagesCallCount = 0;
    dispatchesCallCount = 0;
    routesCallCount = 0;

    packagesQueue = [[]];
    dispatchesQueue = [[]];
    routesQueue = [[]];
    scansRows = [];
    mockSessionRpcResult = { data: null, error: null };
    mockScanRpcResult = { data: null, error: null };
    scanInsertSpy.mockReset();
  });

  it('calls find_or_create_return_reception RPC and exposes session fields', async () => {
    mockSessionRpcResult = {
      data: { ...VALID_SESSION, expected_count: 3, received_count: 1 },
      error: null,
    };
    packagesQueue = [[]];

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessionId).toBe('sess-1');
    expect(result.current.expectedCount).toBe(3);
    expect(result.current.receivedCount).toBe(1);
  });

  it('scan with valid barcode belonging to this route returns "received" with real order status', async () => {
    mockSessionRpcResult = { data: VALID_SESSION, error: null };
    packagesQueue = [
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status_updated_at: '2026-05-10T00:00:00Z', orders: { order_number: 'ORD-1' } }],
    ];
    dispatchesQueue = [
      [{ order_id: 'ord-1', route_id: 'route-a', external_route_id: 'RUTA-001', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
    ];
    scansRows = [];
    mockScanRpcResult = {
      data: { order_status: 'en_bodega', remaining: 0 },
      error: null,
    };

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.scan('CTN001');
    });

    const typed = outcome as { result: string; orderStatus: string; remaining: number };
    expect(typed.result).toBe('received');
    expect(typed.orderStatus).toBe('en_bodega');
    expect(typed.remaining).toBe(0);
  });

  it('scan with unknown barcode returns "not_found" and records a scan with package_id=null', async () => {
    mockSessionRpcResult = { data: VALID_SESSION, error: null };
    packagesQueue = [[], []];

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.scan('UNKNOWN-BAR');
    });

    expect((outcome as { result: string }).result).toBe('not_found');
    expect(scanInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scan_result: 'not_found', package_id: null })
    );
  });

  it('scan with barcode from different route returns "route_mismatch" and uses the route_mismatch enum value', async () => {
    mockSessionRpcResult = { data: VALID_SESSION, error: null };
    scansRows = [];
    packagesQueue = [
      [{ id: 'pkg-99', order_id: 'ord-99', label: 'CTN999', status: 'retorno_hub' }],
    ];
    dispatchesQueue = [
      [{ order_id: 'ord-99', route_id: 'route-x', external_route_id: 'RUTA-999', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [{ id: 'route-x', external_route_id: 'RUTA-999', driver_name: 'Pedro' }],
    ];

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.scan('CTN999');
    });

    expect((outcome as { result: string }).result).toBe('route_mismatch');
    expect(scanInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scan_result: 'route_mismatch', package_id: 'pkg-99' })
    );
  });

  it('duplicate scan of already-received barcode returns "duplicate"', async () => {
    mockSessionRpcResult = { data: { ...VALID_SESSION, expected_count: 1, received_count: 1 }, error: null };
    packagesQueue = [
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status_updated_at: '2026-05-10T00:00:00Z' }],
    ];
    dispatchesQueue = [
      [{ order_id: 'ord-1', route_id: 'route-a', external_route_id: 'RUTA-001', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
    ];
    scansRows = [
      { id: 'scan-1', package_id: 'pkg-1', scan_result: 'received', barcode: 'CTN001' },
    ];

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.scan('CTN001');
    });

    expect((outcome as { result: string }).result).toBe('duplicate');
  });

  it('race-condition double scan (RPC returns package_not_found_or_wrong_status error) maps to "duplicate"', async () => {
    mockSessionRpcResult = { data: VALID_SESSION, error: null };
    packagesQueue = [
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status: 'retorno_hub' }],
    ];
    dispatchesQueue = [
      [{ order_id: 'ord-1', route_id: 'route-a', external_route_id: 'RUTA-001', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
    ];
    scansRows = []; // client-side duplicate check passes
    mockScanRpcResult = {
      data: null,
      error: { message: 'package_not_found_or_wrong_status' },
    };

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.scan('CTN001');
    });

    expect((outcome as { result: string }).result).toBe('duplicate');
  });

  it('is disabled when operatorId is null', async () => {
    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(
      () => useReturnReceptionSession({ operatorId: null, externalRouteId: 'RUTA-001' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.sessionId).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('is disabled when externalRouteId is null', async () => {
    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(
      () => useReturnReceptionSession({ operatorId: 'op-1', externalRouteId: null }),
      { wrapper: createWrapper() }
    );

    expect(result.current.sessionId).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
