import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useNextManifestPickupAddress } from './useNextManifestPickupAddress';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/** Builds a chainable mock ending in `.maybeSingle()`. */
function singleChain(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe('useNextManifestPickupAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch when externalLoadId is null', () => {
    const { result } = renderHook(
      () => useNextManifestPickupAddress('op-1', null),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fetch when operatorId is null', () => {
    const { result } = renderHook(
      () => useNextManifestPickupAddress(null, 'LOAD-1'),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('resolves the real address from pickup_points.pickup_locations[0].address', async () => {
    const orderChain = singleChain({ pickup_point_id: 'pp-1' });
    const pointChain = singleChain({
      pickup_locations: [{ address: 'Av. Providencia 1234, Providencia' }],
    });
    mockFrom.mockImplementation((table: string) =>
      table === 'orders' ? orderChain : pointChain,
    );

    const { result } = renderHook(
      () => useNextManifestPickupAddress('op-1', 'LOAD-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe('Av. Providencia 1234, Providencia');
    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(mockFrom).toHaveBeenCalledWith('pickup_points');
    // operator_id scoped on BOTH queries — non-negotiable.
    expect(orderChain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(pointChain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(orderChain.eq).toHaveBeenCalledWith('external_load_id', 'LOAD-1');
    expect(pointChain.eq).toHaveBeenCalledWith('id', 'pp-1');
  });

  it('returns null, not a fabricated address, when the order has no pickup_point_id', async () => {
    const orderChain = singleChain({ pickup_point_id: null });
    mockFrom.mockReturnValue(orderChain);

    const { result } = renderHook(
      () => useNextManifestPickupAddress('op-1', 'LOAD-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    // Never queries pickup_points without a pickup_point_id to join on.
    expect(mockFrom).not.toHaveBeenCalledWith('pickup_points');
  });

  it('returns null when no matching order exists', async () => {
    const orderChain = singleChain(null);
    mockFrom.mockReturnValue(orderChain);

    const { result } = renderHook(
      () => useNextManifestPickupAddress('op-1', 'LOAD-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns null when pickup_locations is empty — never a placeholder that looks like data', async () => {
    const orderChain = singleChain({ pickup_point_id: 'pp-1' });
    const pointChain = singleChain({ pickup_locations: [] });
    mockFrom.mockImplementation((table: string) =>
      table === 'orders' ? orderChain : pointChain,
    );

    const { result } = renderHook(
      () => useNextManifestPickupAddress('op-1', 'LOAD-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns null when the location entry has no address field', async () => {
    const orderChain = singleChain({ pickup_point_id: 'pp-1' });
    const pointChain = singleChain({ pickup_locations: [{ name: 'Bodega Norte' }] });
    mockFrom.mockImplementation((table: string) =>
      table === 'orders' ? orderChain : pointChain,
    );

    const { result } = renderHook(
      () => useNextManifestPickupAddress('op-1', 'LOAD-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
