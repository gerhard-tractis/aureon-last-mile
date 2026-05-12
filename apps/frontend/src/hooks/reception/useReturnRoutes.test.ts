import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockPackages: unknown[] = [];
let mockDispatches: unknown[] = [];
let mockRoutes: unknown[] = [];

/**
 * Returns a flat chain where every method is chainable (returns the same chain)
 * AND the chain itself is a Promise that resolves with `{ data: rows, error: null }`.
 *
 * This handles any Supabase query regardless of which method ends the chain.
 */
function makeChain(rows: unknown[]) {
  const resolved = Promise.resolve({ data: rows, error: null });

  // Start with Promise methods so `await chain` works
  const chain: Record<string, unknown> = {
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };

  // All chainable methods return the same chain object
  const CHAINABLE = ['select', 'eq', 'is', 'in', 'order', 'limit', 'neq', 'or', 'not', 'match'];
  for (const m of CHAINABLE) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  // Terminal: single resolves with first row
  chain['single'] = vi.fn().mockResolvedValue({
    data: rows[0] ?? null,
    error: rows.length ? null : { code: 'PGRST116' },
  });

  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'packages') return makeChain(mockPackages);
      if (table === 'dispatches') return makeChain(mockDispatches);
      if (table === 'routes') return makeChain(mockRoutes);
      return makeChain([]);
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
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useReturnRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPackages = [];
    mockDispatches = [];
    mockRoutes = [];
  });

  it('returns empty array when no packages in retorno_hub', async () => {
    mockPackages = [];
    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes('op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('groups packages by external_route_id', async () => {
    mockPackages = [
      { id: 'pkg-1', order_id: 'ord-1', status_updated_at: '2026-05-10T08:00:00Z' },
      { id: 'pkg-2', order_id: 'ord-2', status_updated_at: '2026-05-09T08:00:00Z' },
      { id: 'pkg-3', order_id: 'ord-3', status_updated_at: '2026-05-11T08:00:00Z' },
    ];
    mockDispatches = [
      { order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      { order_id: 'ord-2', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      { order_id: 'ord-3', route_id: 'route-b', created_at: '2026-05-01T00:00:00Z' },
    ];
    mockRoutes = [
      { id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan Pérez' },
      { id: 'route-b', external_route_id: 'RUTA-002', driver_name: 'Carlos López' },
    ];

    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes('op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(2);
    const ruta001 = result.current.data.find(r => r.externalRouteId === 'RUTA-001');
    const ruta002 = result.current.data.find(r => r.externalRouteId === 'RUTA-002');
    expect(ruta001?.packageCount).toBe(2);
    expect(ruta002?.packageCount).toBe(1);
  });

  it('puts packages without dispatches in "Sin ruta" bucket', async () => {
    mockPackages = [
      { id: 'pkg-1', order_id: 'ord-1', status_updated_at: '2026-05-10T08:00:00Z' },
      { id: 'pkg-2', order_id: 'ord-orphan', status_updated_at: '2026-05-09T08:00:00Z' },
    ];
    mockDispatches = [
      { order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      // ord-orphan has no dispatch
    ];
    mockRoutes = [
      { id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Juan Pérez' },
    ];

    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes('op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const sinRuta = result.current.data.find(r => r.externalRouteId === 'Sin ruta');
    expect(sinRuta).toBeDefined();
    expect(sinRuta?.packageCount).toBe(1);
  });

  it('computes packageCount correctly per route', async () => {
    mockPackages = [
      { id: 'pkg-1', order_id: 'ord-1', status_updated_at: '2026-05-10T08:00:00Z' },
      { id: 'pkg-2', order_id: 'ord-2', status_updated_at: '2026-05-09T08:00:00Z' },
      { id: 'pkg-3', order_id: 'ord-3', status_updated_at: '2026-05-08T08:00:00Z' },
    ];
    mockDispatches = [
      { order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      { order_id: 'ord-2', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      { order_id: 'ord-3', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
    ];
    mockRoutes = [
      { id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Ana García' },
    ];

    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes('op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data[0].packageCount).toBe(3);
  });

  it('oldestStatusUpdatedAt is the minimum status_updated_at for the route', async () => {
    mockPackages = [
      { id: 'pkg-1', order_id: 'ord-1', status_updated_at: '2026-05-10T08:00:00Z' },
      { id: 'pkg-2', order_id: 'ord-2', status_updated_at: '2026-05-08T06:00:00Z' }, // oldest
      { id: 'pkg-3', order_id: 'ord-3', status_updated_at: '2026-05-12T10:00:00Z' },
    ];
    mockDispatches = [
      { order_id: 'ord-1', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      { order_id: 'ord-2', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
      { order_id: 'ord-3', route_id: 'route-a', created_at: '2026-05-01T00:00:00Z' },
    ];
    mockRoutes = [
      { id: 'route-a', external_route_id: 'RUTA-001', driver_name: 'Ana García' },
    ];

    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes('op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data[0].oldestStatusUpdatedAt).toBe('2026-05-08T06:00:00Z');
  });

  it('returns isLoading false and no error after successful fetch', async () => {
    mockPackages = [];
    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes('op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('is disabled when operatorId is null', async () => {
    const { useReturnRoutes } = await import('./useReturnRoutes');
    const { result } = renderHook(() => useReturnRoutes(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
