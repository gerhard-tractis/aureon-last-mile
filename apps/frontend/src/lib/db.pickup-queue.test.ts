/**
 * spec-81 fase 1, ronda 1 de review (B1) — el almacén de la cola offline de
 * Recogida converge sobre `AureonOfflineDB` (este archivo), la base
 * `aureon_offline` ya cableada a `useSyncQueue`/`SyncChip`/`PickupFlowHeader`.
 *
 * No se crea una tercera base para Recogida: `db.pickup_queue` es una tabla
 * nueva (version 2) en la misma base que ya usa `db.scan_queue`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, getBlockedPickupCount, getPendingPickupCount, requestPersistentStorage } from './db';

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

  describe('getPendingPickupCount (spec-81 fase 2 — por operador, cuenta pending+sending, no dead)', () => {
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

    it('counts sending alongside pending — a stuck sending row must not read as zero', async () => {
      // useSyncQueue.ts stops polling once the combined count is 0. A lone
      // orphaned `sending` row (tab died mid-send, before reclaimStale runs)
      // must not be invisible, or the screen freezes on "all uploaded" with
      // a scan that never actually sent — the spec's declared risk nº1.
      //
      // M-2, ronda 4 de review del PR #679 — `c` (dead) vive ahora en un
      // manifiesto DISTINTO (`m-2`, no `m-1`): un `dead` bloquea TODO el
      // manifiesto que lo contiene (`manifestHasDeadEntry`), así que
      // compartir manifiesto con `a`/`b` haría que M-2 los contara, con
      // razón, como bloqueados en vez de en cola — exactamente lo que M-2
      // pide, pero no lo que ESTE test mide (que `sending` no es invisible).
      // Ese caso cruzado tiene su propio test en `db.test.ts`.
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'pending' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'sending' },
        { ...baseEntry, clientOperationId: 'c', operatorId: 'op-1', status: 'dead', manifestId: 'm-2' },
        { ...baseEntry, clientOperationId: 'd', operatorId: 'op-1', status: 'sent' },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(2);
    });

    // B3, ronda 2 de review del PR #679 (bloqueante): antes de este cambio,
    // `getPendingPickupCount` sumaba `dead` a `queuedCount`, y
    // `SyncChip.tsx` pinta `queuedCount > 0` en verde de éxito — un escaneo
    // irrecuperablemente muerto se mostraba, para siempre, como "todo va
    // bien, está en cola". `dead` deja de contar aquí: `getBlockedPickupCount`
    // (abajo) es su propio contador, para una afordancia distinta.
    it('does NOT count dead — a permanently rejected entry is not "still queued"', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'dead' },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(0);
    });

    // M-2, ronda 4 de review del PR #679 — "mientras esté bloqueada, esa
    // entrada cuenta como bloqueada, no como en cola". Antes de esta ronda,
    // `getPendingPickupCount` contaba TODO `pending`/`sending` sin mirar si
    // el manifiesto podía avanzar de verdad: una entrada atascada detrás de
    // un `dead` en el MISMO manifiesto se mostraba en el badge verde
    // "COLA N" — la misma mentira que B3 corrigió para `dead` en la ronda 2,
    // reintroducida por otra vía.
    it('M-2 — a pending entry behind a dead entry in the SAME manifest does not count as queued', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'dead' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'pending' },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(0);
    });
  });

  describe('getBlockedPickupCount (spec-81 fase 2, ronda 2 de review — B3)', () => {
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

    it('counts only dead entries, scoped to the requesting operator', async () => {
      // M-2, ronda 4 de review del PR #679 — `b` (pending) vive en un
      // manifiesto DISTINTO (`m-2`) del `dead` de `a`: compartir manifiesto
      // habría hecho que `b` contara TAMBIÉN como bloqueado (con razón, es
      // lo que M-2 pide — ver el test dedicado más abajo), lo que este test
      // no mide — mide que un `pending` corriente, sin relación con ningún
      // `dead`, no cuenta aquí.
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'dead' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'pending', manifestId: 'm-2' },
        { ...baseEntry, clientOperationId: 'c', operatorId: 'op-2', status: 'dead' },
      ]);

      await expect(getBlockedPickupCount('op-1')).resolves.toBe(1);
      await expect(getBlockedPickupCount('op-2')).resolves.toBe(1);
    });

    it('is zero when nothing is dead', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'pending' },
      ]);

      await expect(getBlockedPickupCount('op-1')).resolves.toBe(0);
    });

    // M-2, ronda 4 de review del PR #679 — la contraparte de arriba: una
    // entrada `pending` bloqueada por un `dead` en el MISMO manifiesto pasa
    // a contar aquí, no como "sigue en cola" — la afordancia distinta
    // ("está bloqueado, alguien tiene que intervenir") tiene que reflejar
    // TODO lo que está realmente bloqueado, no sólo la fila `dead` literal.
    it('M-2 — a pending entry behind a dead entry in the SAME manifest counts as blocked too', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'dead' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'pending' },
      ]);

      await expect(getBlockedPickupCount('op-1')).resolves.toBe(2);
    });

    // M-2 — cross-user: un `pending` fresco de OTRO usuario por delante en
    // el FIFO también bloquea (`manifestBlockedForUser`), no sólo un `dead`.
    it('M-2 — a pending entry blocked by a fresh cross-user entry ahead of it counts as blocked', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'pending', userId: 'user-b' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'pending', userId: 'user-a' },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(1);
      await expect(getBlockedPickupCount('op-1')).resolves.toBe(1);
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
