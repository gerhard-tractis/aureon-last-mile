import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOrderSnapshot } from './useOrderSnapshot';
import type { TestOrderSnapshot } from './types';

const mockSnapshot: TestOrderSnapshot = {
  order: { id: 'order-1' },
  assignment: null,
  dispatch: null,
  session: null,
  messages: [],
  reschedules: [],
  recent_agent_events: [],
};

describe('useOrderSnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch when orderId is null', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderHook(() => useOrderSnapshot(null));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('returns loading=false and snapshot=null when orderId is null', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useOrderSnapshot(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot).toBeNull();
  });

  it('fetches snapshot when orderId is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSnapshot),
      }),
    );

    const { result } = renderHook(() => useOrderSnapshot('order-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledWith('/api/dev/wismo-test/test-orders/order-1/snapshot');
    expect(result.current.snapshot).toEqual(mockSnapshot);
    expect(result.current.error).toBeNull();
  });

  it('fetches snapshot when orderId changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockSnapshot),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ orderId }: { orderId: string | null }) => useOrderSnapshot(orderId),
      { initialProps: { orderId: 'order-1' as string | null } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dev/wismo-test/test-orders/order-1/snapshot',
    );

    // Change orderId
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ...mockSnapshot, order: { id: 'order-2' } }),
    });

    rerender({ orderId: 'order-2' });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dev/wismo-test/test-orders/order-2/snapshot',
      );
    });
  });

  it('sets error on failed fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'Not found' }),
      }),
    );

    const { result } = renderHook(() => useOrderSnapshot('order-99'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Not found');
    expect(result.current.snapshot).toBeNull();
  });

  it('refresh() re-fetches the snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockSnapshot),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useOrderSnapshot('order-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('loading is true while fetching, false after', async () => {
    let resolveFetch!: (v: unknown) => void;
    const slowPromise = new Promise((res) => {
      resolveFetch = res;
    });

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(slowPromise));

    const { result } = renderHook(() => useOrderSnapshot('order-1'));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, json: async () => mockSnapshot });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
