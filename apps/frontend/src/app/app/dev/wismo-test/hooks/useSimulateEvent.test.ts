import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSimulateEvent } from './useSimulateEvent';
import type { SimulateEventResult } from './types';

const mockResult: SimulateEventResult = {
  snapshot: {
    order: { id: 'order-1' },
    assignment: null,
    dispatch: null,
    session: null,
    messages: [],
    reschedules: [],
    recent_agent_events: [],
  },
  new_messages: [{ text: 'Delivery tomorrow' }],
  new_agent_events: [{ type: 'message_sent' }],
  model_used: 'gpt-4o-mini',
  estimated_cost_usd: 0.0012,
};

describe('useSimulateEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('simulate() throws when orderId is null', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useSimulateEvent(null));

    await expect(
      result.current.simulate({ event_type: 'delivery_attempted' }),
    ).rejects.toThrow('orderId is required');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('simulate() POSTs to /api/dev/wismo-test/simulate-event with correct body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      }),
    );

    const { result } = renderHook(() => useSimulateEvent('order-1'));

    let simResult: SimulateEventResult | undefined;
    await act(async () => {
      simResult = await result.current.simulate({
        event_type: 'delivery_attempted',
        payload: { driver: 'John' },
        model: 'gpt-4o-mini',
      });
    });

    expect(fetch).toHaveBeenCalledWith('/api/dev/wismo-test/simulate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: 'order-1',
        event_type: 'delivery_attempted',
        payload: { driver: 'John' },
        model: 'gpt-4o-mini',
      }),
    });

    expect(simResult).toEqual(mockResult);
  });

  it('simulate() returns SimulateEventResult from response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      }),
    );

    const { result } = renderHook(() => useSimulateEvent('order-1'));

    let simResult: SimulateEventResult | undefined;
    await act(async () => {
      simResult = await result.current.simulate({ event_type: 'delivery_completed' });
    });

    expect(simResult?.model_used).toBe('gpt-4o-mini');
    expect(simResult?.estimated_cost_usd).toBe(0.0012);
    expect(simResult?.new_messages).toHaveLength(1);
  });

  it('sets loading=true during call and false after', async () => {
    let resolveFetch!: (v: unknown) => void;
    const slowPromise = new Promise((res) => {
      resolveFetch = res;
    });

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(slowPromise));

    const { result } = renderHook(() => useSimulateEvent('order-1'));

    expect(result.current.loading).toBe(false);

    let simulatePromise: Promise<SimulateEventResult>;
    act(() => {
      simulatePromise = result.current.simulate({ event_type: 'delivery_attempted' });
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolveFetch({ ok: true, json: async () => mockResult });
      await simulatePromise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('sets error and re-throws on failed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: 'Agent failure' }),
      }),
    );

    const { result } = renderHook(() => useSimulateEvent('order-1'));

    let thrownError: Error | undefined;
    await act(async () => {
      try {
        await result.current.simulate({ event_type: 'delivery_attempted' });
      } catch (err) {
        thrownError = err as Error;
      }
    });

    expect(thrownError?.message).toBe('Agent failure');
    expect(result.current.error).toBe('Agent failure');
  });

  it('simulate() sends only required fields when optional fields are omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      }),
    );

    const { result } = renderHook(() => useSimulateEvent('order-1'));

    await act(async () => {
      await result.current.simulate({ event_type: 'delivery_attempted' });
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/dev/wismo-test/simulate-event',
      expect.objectContaining({
        body: JSON.stringify({
          order_id: 'order-1',
          event_type: 'delivery_attempted',
          payload: undefined,
          model: undefined,
        }),
      }),
    );
  });
});
