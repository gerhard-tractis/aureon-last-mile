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
      claimToken: null,
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

    const { result } = renderHook(() => useSyncQueue('op-1'));

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

    const { result } = renderHook(() => useSyncQueue('op-1'));

    await waitFor(() => expect(result.current.queuedCount).toBe(3));
  });

  it('does not count sent pickup_queue entries', async () => {
    await seedPickupQueue(1);
    const [only] = await db.pickup_queue.toArray();
    await db.pickup_queue.update(only.id!, { status: 'sent' });

    const { result } = renderHook(() => useSyncQueue('op-1'));

    await waitFor(() => expect(result.current.status).not.toBe('syncing'));
    expect(result.current.queuedCount).toBe(0);
  });

  it('H2 — scanQueueCount reflects only scan_queue, the queue retryNow can actually drain', async () => {
    // The Recepción panel shows this number in its header, lists `recent`
    // (scan_queue only) below it, and its "Reintentar ahora" button drains
    // scan_queue only (syncManager.manualSync -> getUnsynced). Feeding it the
    // combined `queuedCount` once pickup_queue has entries would show a
    // number the list and the button can't back up (spec-81, ronda 3, H2).
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

    const { result } = renderHook(() => useSyncQueue('op-1'));

    await waitFor(() => expect(result.current.queuedCount).toBe(3));
    expect(result.current.scanQueueCount).toBe(1);
  });

  it('fase 2 — does not count another operator\'s pickup_queue entries on the same device', async () => {
    // A driver closes out on a dock phone; a second driver opens the same
    // phone next. Without per-operator scoping the badge would show the
    // first driver's leftovers to the second, who can neither drain nor
    // purge them (spec-81, "Alcance del contador").
    await seedPickupQueue(3, 'op-1');
    await seedPickupQueue(5, 'op-2');

    const { result } = renderHook(() => useSyncQueue('op-2'));

    await waitFor(() => expect(result.current.queuedCount).toBe(5));
  });

  it('fase 2 — reports 0 pickup_queue entries when no operator is known yet', async () => {
    await seedPickupQueue(4, 'op-1');

    const { result } = renderHook(() => useSyncQueue(null));

    await waitFor(() => expect(result.current.status).not.toBe('syncing'));
    expect(result.current.queuedCount).toBe(0);
  });

  // B3, ronda 2 de review del PR #679 (bloqueante): un `dead` no es "sigue
  // en cola" — es un bloqueo permanente. Antes contaba dentro de
  // `queuedCount`, que `SyncChip.tsx` pinta en verde de éxito; ahora tiene
  // su propio contador (`blockedCount`), separado.
  it('does not count dead entries in queuedCount, and counts them in blockedCount', async () => {
    await seedPickupQueue(1);
    const [only] = await db.pickup_queue.toArray();
    await db.pickup_queue.update(only.id!, { status: 'dead' });

    const { result } = renderHook(() => useSyncQueue('op-1'));

    await waitFor(() => expect(result.current.blockedCount).toBe(1));
    expect(result.current.queuedCount).toBe(0);
  });

  it('blockedCount is scoped per operator, same as queuedCount', async () => {
    await seedPickupQueue(1, 'op-1');
    await seedPickupQueue(1, 'op-2');
    const rows = await db.pickup_queue.toArray();
    await db.pickup_queue.update(rows.find((r) => r.operatorId === 'op-1')!.id!, {
      status: 'dead',
    });

    const { result } = renderHook(() => useSyncQueue('op-2'));

    await waitFor(() => expect(result.current.status).not.toBe('syncing'));
    expect(result.current.blockedCount).toBe(0);
  });

  // m7, ronda 3 de review del PR #679 (menor) — el gate de polling
  // (`status === 'online' && queuedCount === 0`) ignoraba `blockedCount`.
  // Con la última `pending` convertida en `dead` (B3), el polling se
  // detenía aunque hubiera bloqueados; cuando una fase futura añada la
  // resolución del bloqueo desde el servidor, el chip no la reflejaría
  // hasta un remount.
  it('m7 — keeps polling while blockedCount > 0, even with queuedCount at 0 and status online', async () => {
    await seedPickupQueue(1);
    const [only] = await db.pickup_queue.toArray();
    await db.pickup_queue.update(only.id!, { status: 'dead' });

    const { result } = renderHook(() => useSyncQueue('op-1'));

    await waitFor(() => expect(result.current.blockedCount).toBe(1));
    expect(result.current.queuedCount).toBe(0);
    expect(result.current.status).toBe('online');

    // A new pending entry arrives on this device (e.g. a fresh scan)
    // without any `online`/`offline` event firing — only the poll interval
    // (real time; `POLL_MS` = 2000ms) can pick it up.
    await db.pickup_queue.add({
      clientOperationId: 'client-op-new',
      operatorId: 'op-1',
      manifestId: 'manifest-1',
      type: 'pickup_scan',
      payload: { barcode: 'SCAN-NEW' },
      status: 'pending',
      retryCount: 0,
      claimToken: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: new Date().toISOString(),
    });

    await waitFor(() => expect(result.current.queuedCount).toBe(1), { timeout: 5_000 });
  }, 10_000);

  it('requests persistent storage on mount (M4 — "GUARDADO EN EL DISPOSITIVO" must be true)', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      value: { persist },
      configurable: true,
    });

    renderHook(() => useSyncQueue('op-1'));

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());

    // @ts-expect-error -- test-only cleanup of a jsdom property we added
    delete navigator.storage;
  });
});
