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

  describe('getPendingPickupCount', () => {
    it('counts only pending entries, device-global (mirrors getUnsynced)', async () => {
      await db.pickup_queue.bulkAdd([
        {
          clientOperationId: 'a',
          operatorId: 'op-1',
          manifestId: 'm-1',
          type: 'pickup_scan',
          payload: {},
          status: 'pending',
          retryCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          createdAt: new Date().toISOString(),
        },
        {
          clientOperationId: 'b',
          operatorId: 'op-2',
          manifestId: 'm-2',
          type: 'pickup_scan',
          payload: {},
          status: 'pending',
          retryCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          createdAt: new Date().toISOString(),
        },
        {
          clientOperationId: 'c',
          operatorId: 'op-1',
          manifestId: 'm-1',
          type: 'pickup_scan',
          payload: {},
          status: 'sent',
          retryCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      await expect(getPendingPickupCount()).resolves.toBe(2);
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
  });
});
