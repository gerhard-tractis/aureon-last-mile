/**
 * spec-81 fase 1, ronda 1 de review (B1) — `queuedCount` tiene que sumar la
 * cola de Recogida (`db.pickup_queue`), no sólo `db.scan_queue`.
 *
 * Sin esto, `SyncChip` y `PickupFlowHeader` muestran 0 mientras N escaneos
 * de Recogida esperan señal para subir — exactamente el riesgo nº1 del spec.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import { useSyncQueue } from './useSyncQueue';

async function seedPickupQueue(count: number, operatorId = 'op-1') {
  for (let i = 0; i < count; i++) {
    await db.pickup_queue.add({
      clientOperationId: `client-op-${i}`,
      operatorId,
      manifestId: 'manifest-1',
      type: 'pickup_scan',
      payload: { barcode: `SCAN-${i}` },
      status: 'pending',
      retryCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: new Date().toISOString(),
    });
  }
}

describe('useSyncQueue — queuedCount includes the Recogida queue', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
    await db.scan_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
    await db.scan_queue.clear();
  });

  it('counts pending pickup_queue entries even when scan_queue is empty', async () => {
    await seedPickupQueue(3);

    const { result } = renderHook(() => useSyncQueue());

    await waitFor(() => expect(result.current.queuedCount).toBe(3));
  });

  it('sums scan_queue unsynced rows and pickup_queue pending rows', async () => {
    await seedPickupQueue(2);
    await db.scan_queue.add({
      manifest_id: 'manifest-1',
      order_id: 'order-1',
      barcode_scanned: 'SCAN-A',
      scan_status: 'success',
      scanned_at: new Date(),
      synced: false,
      operator_id: 'op-1',
      user_id: 'user-1',
      created_at: new Date(),
    });

    const { result } = renderHook(() => useSyncQueue());

    await waitFor(() => expect(result.current.queuedCount).toBe(3));
  });

  it('does not count sent pickup_queue entries', async () => {
    await seedPickupQueue(1);
    const [only] = await db.pickup_queue.toArray();
    await db.pickup_queue.update(only.id!, { status: 'sent' });

    const { result } = renderHook(() => useSyncQueue());

    await waitFor(() => expect(result.current.status).not.toBe('syncing'));
    expect(result.current.queuedCount).toBe(0);
  });

  it('requests persistent storage on mount (M4 — "GUARDADO EN EL DISPOSITIVO" must be true)', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      value: { persist },
      configurable: true,
    });

    renderHook(() => useSyncQueue());

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());

    // @ts-expect-error -- test-only cleanup of a jsdom property we added
    delete navigator.storage;
  });
});
