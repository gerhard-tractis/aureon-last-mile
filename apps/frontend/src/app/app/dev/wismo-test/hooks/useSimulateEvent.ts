'use client';

import { useState, useCallback } from 'react';
import type { SimulateEventResult } from './types';

interface SimulateOptions {
  event_type: string;
  payload?: Record<string, unknown>;
  model?: string;
}

export function useSimulateEvent(orderId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(
    async (opts: SimulateOptions): Promise<SimulateEventResult> => {
      if (!orderId) {
        throw new Error('orderId is required to simulate an event');
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/dev/wismo-test/simulate-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: orderId,
            event_type: opts.event_type,
            payload: opts.payload,
            model: opts.model,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const result: SimulateEventResult = await res.json();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [orderId],
  );

  return { loading, error, simulate };
}
