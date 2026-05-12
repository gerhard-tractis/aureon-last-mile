import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockSessionRows: unknown[] = [];
let mockInsertSessionData: unknown = null;
let mockInsertSessionError: unknown = null;

// These arrays rotate: first call gets index 0, second gets index 1, etc.
// Allows different data per repeated call to the same table.
let packagesQueue: unknown[][] = [[]];
let dispatchesQueue: unknown[][] = [[]];
let routesQueue: unknown[][] = [[]];
let scansRows: unknown[] = [];

let mockRpcResult: { data: unknown; error: unknown } = { data: null, error: null };

let packagesCallCount = 0;
let dispatchesCallCount = 0;
let routesCallCount = 0;

/**
 * Flat chain — every method returns `this` (same chain), and the chain is a
 * Promise that resolves with `{ data: rows, error: null }`. Any method can be
 * the last in a chain and `await` will still work.
 */
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
      if (table === 'return_receptions') {
        const base = makeChain(mockSessionRows);
        (base as Record<string, unknown>)['insert'] = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockInsertSessionData,
              error: mockInsertSessionError,
            }),
          }),
        });
        return base;
      }

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
        (base as Record<string, unknown>)['insert'] = vi.fn().mockResolvedValue({ error: null });
        return base;
      }

      return makeChain([]);
    },

    rpc: vi.fn().mockResolvedValue(mockRpcResult),

    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useReturnReceptionSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    packagesCallCount = 0;
    dispatchesCallCount = 0;
    routesCallCount = 0;

    mockSessionRows = [];
    packagesQueue = [[]];
    dispatchesQueue = [[]];
    routesQueue = [[]];
    scansRows = [];
    mockInsertSessionData = null;
    mockInsertSessionError = null;
    mockRpcResult = { data: null, error: null };
  });

  // ── Session lifecycle ────────────────────────────────────────────────────────

  it('creates a new session when none exists for the route', async () => {
    mockSessionRows = [];  // no existing session → triggers insert
    mockInsertSessionData = {
      id: 'sess-new',
      operator_id: 'op-1',
      external_route_id: 'RUTA-001',
      status: 'in_progress',
      expected_count: 0,
      received_count: 0,
    };
    packagesQueue = [[]];  // no packages

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessionId).toBe('sess-new');
  });

  it('reuses an existing pending/in_progress session', async () => {
    mockSessionRows = [
      {
        id: 'sess-existing',
        operator_id: 'op-1',
        external_route_id: 'RUTA-001',
        status: 'in_progress',
        expected_count: 3,
        received_count: 1,
      },
    ];
    packagesQueue = [[]];

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessionId).toBe('sess-existing');
  });

  // ── Scan outcomes ────────────────────────────────────────────────────────────

  it('scan with valid barcode belonging to this route returns "received"', async () => {
    mockSessionRows = [
      {
        id: 'sess-1',
        operator_id: 'op-1',
        external_route_id: 'RUTA-001',
        status: 'in_progress',
        expected_count: 1,
        received_count: 0,
      },
    ];
    // First packages call: route loading (returns route packages)
    // Second packages call: barcode lookup during scan
    packagesQueue = [
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status_updated_at: '2026-05-10T00:00:00Z' }],
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status: 'retorno_hub' }],
    ];
    // First dispatches: route loading; second: scan route-check
    dispatchesQueue = [
      [{ order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' }],
      [{ order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
    ];
    scansRows = [];
    mockRpcResult = {
      data: { order_status: 'delivered', remaining: 0 },
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

    expect((outcome as { result: string }).result).toBe('received');
  });

  it('scan with unknown barcode returns "not_found"', async () => {
    mockSessionRows = [
      {
        id: 'sess-1',
        operator_id: 'op-1',
        external_route_id: 'RUTA-001',
        status: 'in_progress',
        expected_count: 1,
        received_count: 0,
      },
    ];
    packagesQueue = [[], []];  // both calls return empty

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
  });

  it('scan with barcode from different route returns "route_mismatch"', async () => {
    mockSessionRows = [
      {
        id: 'sess-1',
        operator_id: 'op-1',
        external_route_id: 'RUTA-001',
        status: 'in_progress',
        expected_count: 1,
        received_count: 0,
      },
    ];
    scansRows = [];
    // First packages call: route loading (empty — different route)
    // Second packages call: barcode lookup → finds the package
    packagesQueue = [
      [],
      [{ id: 'pkg-99', order_id: 'ord-99', label: 'CTN999', status: 'retorno_hub' }],
    ];
    // dispatches + routes for the scan's route-check
    dispatchesQueue = [
      [],
      [{ order_id: 'ord-99', route_id: 'route-x', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [],
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
  });

  it('duplicate scan of already-received barcode returns "duplicate"', async () => {
    mockSessionRows = [
      {
        id: 'sess-1',
        operator_id: 'op-1',
        external_route_id: 'RUTA-001',
        status: 'in_progress',
        expected_count: 1,
        received_count: 1,
      },
    ];
    packagesQueue = [
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status_updated_at: '2026-05-10T00:00:00Z' }],
      [{ id: 'pkg-1', order_id: 'ord-1', label: 'CTN001', status: 'retorno_hub' }],
    ];
    dispatchesQueue = [
      [{ order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' }],
      [{ order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' }],
    ];
    routesQueue = [
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
      [{ id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan' }],
    ];
    // Already has a received scan for this package
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

  it('expectedCount and receivedCount are exposed from the session', async () => {
    mockSessionRows = [
      {
        id: 'sess-1',
        operator_id: 'op-1',
        external_route_id: 'RUTA-001',
        status: 'in_progress',
        expected_count: 5,
        received_count: 2,
      },
    ];
    packagesQueue = [[]];

    const { useReturnReceptionSession } = await import('./useReturnReceptionSession');
    const { result } = renderHook(() => useReturnReceptionSession(BASE_OPTS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.expectedCount).toBe(5);
    expect(result.current.receivedCount).toBe(2);
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
