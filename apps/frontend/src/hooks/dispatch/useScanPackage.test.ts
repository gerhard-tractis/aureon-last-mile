import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useScanPackage } from './useScanPackage';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return { Wrapper, invalidateSpy };
}

describe('useScanPackage', () => {
  it('exposes a mutateAsync function', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useScanPackage('route-1'), { wrapper: Wrapper });
    expect(typeof result.current.mutateAsync).toBe('function');
  });

  it('calls POST /api/dispatch/routes/[id]/scan with code', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dispatch_id: 'd1', order_number: 'ORD-1', ok: true }),
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useScanPackage('route-99'), { wrapper: Wrapper });
    await result.current.mutateAsync('BARCODE-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/route-99/scan',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('spec-76 review I5 — invalidates the 2h (route-packages-by-stop) cache too, not just [dispatch, packages]', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dispatch_id: 'd1', order_number: 'ORD-1', ok: true }),
    });
    const { Wrapper, invalidateSpy } = wrapper();
    const { result } = renderHook(() => useScanPackage('route-99', 'op-1'), { wrapper: Wrapper });
    await result.current.mutateAsync('BARCODE-1');

    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(['dispatch', 'packages', 'route-99']);
    expect(keys).toContainEqual(['dispatch', 'mobile', 'route-packages-by-stop', 'route-99', 'op-1']);
  });

  it("spec-78 review C2 — invalidates the load-brief cache (3a's \"en el andén\" / órdenes incompletas), or it freezes on a device nobody touches", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dispatch_id: 'd1', order_number: 'ORD-1', ok: true }),
    });
    const { Wrapper, invalidateSpy } = wrapper();
    const { result } = renderHook(() => useScanPackage('route-99', 'op-1'), { wrapper: Wrapper });
    await result.current.mutateAsync('BARCODE-1');

    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(['dispatch', 'mobile', 'route-load-brief', 'route-99', 'op-1']);
  });
});
