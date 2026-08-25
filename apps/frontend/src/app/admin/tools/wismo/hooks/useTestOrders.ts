'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TestOrder, CreateTestOrderInput, TestOrderSnapshot } from './types';

export function useTestOrders() {
  const [orders, setOrders] = useState<TestOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/wismo-test/test-orders');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.orders ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (
      input: CreateTestOrderInput,
    ): Promise<{ order_id: string; snapshot: TestOrderSnapshot }> => {
      const res = await fetch('/api/dev/wismo-test/test-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = await res.json();
      await refresh();
      return result;
    },
    [refresh],
  );

  const purge = useCallback(async (): Promise<{ deleted_count: number }> => {
    const res = await fetch('/api/dev/wismo-test/test-orders/purge', {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const result = await res.json();
    await refresh();
    return result;
  }, [refresh]);

  return {
    orders,
    loading,
    error,
    refresh,
    create,
    purge,
  };
}
