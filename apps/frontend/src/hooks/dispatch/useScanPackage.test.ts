import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useScanPackage } from './useScanPackage';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

describe('useScanPackage', () => {
  it('exposes a mutateAsync function', () => {
    const { result } = renderHook(() => useScanPackage('route-1'), { wrapper: wrapper() });
    expect(typeof result.current.mutateAsync).toBe('function');
  });

  it('calls POST /api/dispatch/routes/[id]/scan with code', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dispatch_id: 'd1', order_number: 'ORD-1', ok: true }),
    });
    const { result } = renderHook(() => useScanPackage('route-99'), { wrapper: wrapper() });
    await result.current.mutateAsync('BARCODE-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/route-99/scan',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
