import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRemovePackageFromRoute } from './useRemovePackageFromRoute';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return { Wrapper, invalidateSpy };
}

describe('useRemovePackageFromRoute', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('DELETEs the dispatch (order-level) endpoint with the reason in the body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, load_position_conflict: false }),
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRemovePackageFromRoute('op-1'), { wrapper: Wrapper });

    result.current.mutate({ routeId: 'r1', dispatchId: 'd1', reason: 'Paquete dañado' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/r1/packages/d1',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ reason: 'Paquete dañado' }),
      }),
    );
  });

  it('invalidates both the 2h and route-packages caches on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, load_position_conflict: false }),
    });
    const { Wrapper, invalidateSpy } = wrapper();
    const { result } = renderHook(() => useRemovePackageFromRoute('op-1'), { wrapper: Wrapper });

    result.current.mutate({ routeId: 'r1', dispatchId: 'd1', reason: 'x' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(['dispatch', 'mobile', 'route-packages-by-stop', 'r1', 'op-1']);
    expect(keys).toContainEqual(['dispatch', 'packages', 'r1']);
  });

  it('surfaces the real 403 message when the server refuses (manager-only removal)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'FORBIDDEN', message: 'Solo un responsable puede quitar paradas de la planificación.' }),
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRemovePackageFromRoute('op-1'), { wrapper: Wrapper });

    result.current.mutate({ routeId: 'r1', dispatchId: 'd1', reason: 'x' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as { message: string }).message).toBe(
      'Solo un responsable puede quitar paradas de la planificación.',
    );
    expect((result.current.error as { code: string }).code).toBe('FORBIDDEN');
  });

  it('falls back to a generic message when the server response has none', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRemovePackageFromRoute('op-1'), { wrapper: Wrapper });

    result.current.mutate({ routeId: 'r1', dispatchId: 'd1', reason: 'x' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { message: string }).message).toBe('No se pudo quitar el paquete de la ruta');
  });
});
