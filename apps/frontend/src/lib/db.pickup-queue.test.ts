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
import { listDeadPickupEntries } from './offline/queue';
import * as queueBlockingLib from './offline/queue-blocking';

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
      // Ese caso cruzado tiene su propio test más abajo, en este mismo
      // fichero (menor 1, ronda 5 de review del PR #679 — la referencia
      // original a `db.test.ts` quedó colgando cuando ese archivo se
      // consolidó aquí en `98e941f`).
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

    // Menor 2, ronda 5 de review del PR #679 — se perdió al consolidar
    // `db.test.ts` en este fichero (`98e941f`); recuperado. Un manifiesto
    // bloqueado (cross-user) no puede filtrar hacia el conteo de otro
    // manifiesto sin relación, aunque compartan operador.
    it('does not let one blocked manifest affect the count of an unrelated one', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', status: 'pending', userId: 'user-b' },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', status: 'pending', userId: 'user-a' },
        {
          ...baseEntry,
          clientOperationId: 'c',
          operatorId: 'op-1',
          status: 'pending',
          userId: 'user-a',
          manifestId: 'm-2',
        },
      ]);

      await expect(getPendingPickupCount('op-1')).resolves.toBe(2);
      await expect(getBlockedPickupCount('op-1')).resolves.toBe(1);
    });

    // M-2, ronda 5 de review del PR #679 (mayor) — `getPendingPickupCount`/
    // `getBlockedPickupCount` llamaban `manifestIsBlocked` UNA VEZ POR
    // ENTRADA, y cada llamada hace 2 escaneos completos del índice
    // (`manifestHasDeadEntry` + `manifestHead`/`manifestBlockedForUser`).
    // `useSyncQueue` invoca ambos contadores cada `POLL_MS` (2s). Medido por
    // el reviewer: N=200 (dentro del tope de 500 que declara `enqueue`, el
    // escenario normal de una carga escaneada sin red) tardaba 21 SEGUNDOS
    // por contador — con poll cada 2s, transacciones solapándose sin fin en
    // la pantalla de escaneo. El conjunto de manifiestos bloqueados debe
    // calcularse UNA VEZ POR LLAMADA, no una vez por entrada — son unos
    // pocos manifiestos, no cientos de entradas.
    it('M-2 — computes the blocked set once per distinct (manifest, owner), not once per entry', async () => {
      const ENTRY_COUNT = 200;
      await db.pickup_queue.bulkAdd(
        Array.from({ length: ENTRY_COUNT }, (_, i) => ({
          ...baseEntry,
          clientOperationId: `bulk-${i}`,
          operatorId: 'op-1',
          status: 'pending' as const,
          // Todas en el mismo manifiesto y del mismo dueño — el caso normal
          // (una carga, un operario) y el peor caso para un algoritmo que no
          // memoiza: 200 llamadas idénticas a `manifestIsBlocked` en vez de
          // una sola.
          manifestId: 'm-bulk',
          userId: 'user-a',
        })),
      );
      const manifestIsBlockedSpy = vi.spyOn(queueBlockingLib, 'manifestIsBlocked');

      await getPendingPickupCount('op-1');

      expect(manifestIsBlockedSpy.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  // spec-81 fase 4 — el detalle detrás de `getBlockedPickupCount`. Ese
  // contador mezcla dos cosas que necesitan afordancias distintas: un
  // `dead` real (rechazo de negocio, tiene `lastError`, necesita ayuda
  // humana) y un `pending` bloqueado temporalmente por otro operario
  // (`manifestBlockedForUser` — se libera solo, nunca tuvo `lastError`
  // porque nunca llegó a intentarse). El chip necesita SÓLO lo primero para
  // explicar "qué manifiesto está bloqueado y por qué" — mostrar lo segundo
  // como si necesitara ayuda sería mentir en la otra dirección.
  describe('listDeadPickupEntries', () => {
    const baseEntry = {
      manifestId: 'm-1',
      type: 'pickup_scan' as const,
      payload: {},
      retryCount: 3,
      claimToken: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: new Date().toISOString(),
    };

    it('returns only dead entries for the requesting operator, with their manifest and lastError', async () => {
      await db.pickup_queue.bulkAdd([
        {
          ...baseEntry,
          clientOperationId: 'a',
          operatorId: 'op-1',
          userId: 'user-a',
          status: 'dead',
          lastError: 'MANIFEST_NOT_CLOSABLE',
        },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', userId: 'user-a', status: 'pending' },
        {
          ...baseEntry,
          clientOperationId: 'c',
          operatorId: 'op-2',
          userId: 'user-a',
          status: 'dead',
          lastError: 'OPERATOR_SIGNATURE_REQUIRED',
        },
      ]);

      const entries = await listDeadPickupEntries(db, 'op-1');

      expect(entries).toHaveLength(1);
      expect(entries[0].clientOperationId).toBe('a');
      expect(entries[0].manifestId).toBe('m-1');
      expect(entries[0].lastError).toBe('MANIFEST_NOT_CLOSABLE');
    });

    it('does not include a pending entry merely blocked behind another dead or cross-user entry — only literal dead rows', async () => {
      // `getBlockedPickupCount` cuenta esta `pending` como bloqueada
      // (M-2, ronda 4 del PR #679) porque no puede avanzar — pero no tiene
      // `lastError` ni ningún rechazo que explicar; contarla aquí
      // convertiría "está detrás de un dead" en "esta fila necesita ayuda",
      // que no es cierto para ELLA.
      await db.pickup_queue.bulkAdd([
        {
          ...baseEntry,
          clientOperationId: 'a',
          operatorId: 'op-1',
          userId: 'user-a',
          status: 'dead',
          lastError: 'MANIFEST_NOT_CLOSABLE',
        },
        { ...baseEntry, clientOperationId: 'b', operatorId: 'op-1', userId: 'user-a', status: 'pending' },
      ]);

      const entries = await listDeadPickupEntries(db, 'op-1');

      expect(entries.map((e) => e.clientOperationId)).toEqual(['a']);
    });

    it('is empty when nothing is dead', async () => {
      await db.pickup_queue.bulkAdd([
        { ...baseEntry, clientOperationId: 'a', operatorId: 'op-1', userId: 'user-a', status: 'pending' },
      ]);

      await expect(listDeadPickupEntries(db, 'op-1')).resolves.toEqual([]);
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
