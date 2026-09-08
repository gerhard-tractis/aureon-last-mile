/**
 * spec-81 fase 1, ronda 1 de review (B1) — el almacén de la cola offline de
 * Recogida converge sobre `AureonOfflineDB` (este archivo), la base
 * `aureon_offline` ya cableada a `useSyncQueue`/`SyncChip`/`PickupFlowHeader`.
 *
 * No se crea una tercera base para Recogida: `db.pickup_queue` es una tabla
 * nueva (version 2) en la misma base que ya usa `db.scan_queue`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, getPendingPickupCount, requestPersistentStorage } from './db';

describe('AureonOfflineDB — pickup_queue (spec-81)', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
    await db.scan_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
    await db.scan_queue.clear();
  });

  it('adds pickup_queue as a version-2 table without dropping scan_queue', () => {
    // Bumping the schema version must carry the existing store forward —
    // this is the whole point of converging instead of building a sibling DB.
    expect(db.scan_queue).toBeDefined();
    expect(db.pickup_queue).toBeDefined();
    expect(db.verno).toBe(2);
  });

  describe('getPendingPickupCount (spec-81 fase 2 — por operador, cuenta pending+sending+dead)', () => {
    const baseEntry = {
      manifestId: 'm-1',
      type: 'pickup_scan' as const,
      payload: {},
      retryCount: 0,
      claimToken: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: new Date().toISOString(),
    };

    it('only counts the requesting operator, not another operator sharing the device', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'pending' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-2', status: 'pending' },
        { ...baseEntry, clientOperationId: 'c', operatorId: 'op-1', status: 'sent' },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(1);
      await expect(getPendingPickupCount('op-2')).resolves.toBe(1);
    });

    it('counts sending and dead alongside pending — a stuck sending row must not read as zero', async () => {
      // useSyncQueue.ts stops polling once the combined count is 0. A lone
      // orphaned `sending` row (tab died mid-send, before reclaimStale runs)
      // must not be invisible, or the screen freezes on "all uploaded" with
      // a scan that never actually sent — the spec's declared risk nº1.
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'pending' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'sending' },
        { ...baseEntry, clientOperationId: 'c', operatorId: 'op-1', status: 'dead' },
        { ...baseEntry, clientOperationId: 'd', operatorId: 'op-1', status: 'sent' },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(3);
    });
  });

  describe('requestPersistentStorage', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('asks the browser for persistent storage when the API exists', async () => {
      const persist = vi.fn().mockResolvedValue(true);
      vi.stubGlobal('navigator', { storage: { persist } });

      const granted = await requestPersistentStorage();

      expect(persist).toHaveBeenCalledOnce();
      expect(granted).toBe(true);
    });

    it('is a safe no-op when the API is unavailable', async () => {
      vi.stubGlobal('navigator', {});

      await expect(requestPersistentStorage()).resolves.toBe(false);
    });

    it('N1 — returns exactly what the browser granted, not a hardcoded true', async () => {
      const persist = vi.fn().mockResolvedValue(false);
      vi.stubGlobal('navigator', { storage: { persist } });

      const granted = await requestPersistentStorage();

      expect(granted).toBe(false);
    });
  });
});
