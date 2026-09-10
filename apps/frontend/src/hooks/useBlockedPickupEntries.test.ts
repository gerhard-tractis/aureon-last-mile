/**
 * spec-81 fase 4 — el detalle detrás del contador `blockedCount` de
 * `useSyncQueue`: qué manifiesto está bloqueado, por qué (`lastError`), y
 * si ese bloqueo concreto detiene el cierre de la carga o no
 * (`deadEntryBlocksManifestClose` — una foto muerta no lo hace).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import { useBlockedPickupEntries } from './useBlockedPickupEntries';

const baseEntry = {
  operatorId: 'op-1',
  userId: 'user-1',
  manifestId: 'manifest-1',
  payload: {},
  retryCount: 3,
  claimToken: null,
  lastAttemptAt: null,
  nextAttemptAt: null,
  createdAt: new Date().toISOString(),
};

describe('useBlockedPickupEntries', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
    vi.restoreAllMocks();
  });

  it('is empty and idle while blockedCount is 0, without reading the database', async () => {
    const spy = vi.spyOn(db.pickup_queue, 'where');

    const { result } = renderHook(() => useBlockedPickupEntries('op-1', 0));

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.entries).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads the dead entries for the operator once blockedCount is positive', async () => {
    await db.pickup_queue.add({
      ...baseEntry,
      clientOperationId: 'a',
      type: 'pickup_scan',
      status: 'dead',
      lastError: 'MANIFEST_NOT_CLOSABLE',
    });

    const { result } = renderHook(() => useBlockedPickupEntries('op-1', 1));

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].lastError).toBe('MANIFEST_NOT_CLOSABLE');
  });

  it('does nothing without an operatorId — no operator to scope the query to', async () => {
    const spy = vi.spyOn(db.pickup_queue, 'where');

    const { result } = renderHook(() => useBlockedPickupEntries(null, 1));

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(spy).not.toHaveBeenCalled();
  });

  // La cola vive en IndexedDB — best-effort en algunos navegadores (modo
  // privado, cuota agotada). Un fallo de lectura no puede leerse igual que
  // "no hay nada bloqueado": `blockedCount` (otra lectura, en
  // `useSyncQueue`) puede seguir en pie diciendo que SÍ hay algo, y un
  // `entries: []` silencioso pintaría un chip vacío mientras el badge dice
  // lo contrario.
  it('reports an error status instead of silently showing zero when the read fails', async () => {
    vi.spyOn(db.pickup_queue, 'where').mockImplementation(() => {
      throw new Error('IndexedDB unavailable');
    });

    const { result } = renderHook(() => useBlockedPickupEntries('op-1', 1));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.entries).toEqual([]);
  });

  it('re-reads when blockedCount changes', async () => {
    const { result, rerender } = renderHook(
      ({ blockedCount }) => useBlockedPickupEntries('op-1', blockedCount),
      { initialProps: { blockedCount: 0 } },
    );

    await waitFor(() => expect(result.current.status).toBe('idle'));

    await db.pickup_queue.add({
      ...baseEntry,
      clientOperationId: 'a',
      type: 'close_manifest',
      status: 'dead',
      lastError: 'OPERATOR_SIGNATURE_REQUIRED',
    });
    rerender({ blockedCount: 1 });

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
  });

  // Ronda 2 de review del PR #725 (B1 bloqueante) — el resto de
  // `blockedCount` no explicado por `listDeadPickupEntries` NO es siempre
  // espera cross-user. `manifestHasDeadEntry` bloquea CUALQUIER `pending`
  // del MISMO manifiesto que un `dead`, sin que exista otro operario.
  describe('sameManifestBlockedCount vs crossUserBlockedCount', () => {
    it('attributes the remainder to the same blocked manifest, not to another operator, when that is what it is', async () => {
      await db.pickup_queue.add({
        ...baseEntry,
        clientOperationId: 'dead-1',
        manifestId: 'm-1',
        type: 'close_manifest',
        status: 'dead',
        lastError: 'MANIFEST_NOT_CLOSABLE',
      });
      // Cuatro `pending` en el MISMO manifiesto, mismo operador, mismo
      // usuario — nada de cross-user aquí. `getBlockedPickupCount` real
      // contaría estas 4 como bloqueadas (5 en total); se lo pasamos
      // directo al hook, que es lo único que necesita para el cálculo.
      await db.pickup_queue.bulkAdd(
        Array.from({ length: 4 }, (_, i) => ({
          ...baseEntry,
          clientOperationId: `pending-${i}`,
          manifestId: 'm-1',
          type: 'pickup_scan' as const,
          status: 'pending' as const,
        })),
      );

      const { result } = renderHook(() => useBlockedPickupEntries('op-1', 5));

      await waitFor(() => expect(result.current.status).toBe('ok'));
      expect(result.current.sameManifestBlockedCount).toBe(4);
      expect(result.current.crossUserBlockedCount).toBe(0);
    });

    it('attributes the remainder to cross-user waiting when no dead entry explains it', async () => {
      // Sin ningún `dead` — el caso puro cross-user (una `pending` fresca
      // de otro usuario por delante en el FIFO).
      const { result } = renderHook(() => useBlockedPickupEntries('op-1', 2));

      await waitFor(() => expect(result.current.status).toBe('ok'));
      expect(result.current.entries).toEqual([]);
      expect(result.current.sameManifestBlockedCount).toBe(0);
      expect(result.current.crossUserBlockedCount).toBe(2);
    });

    it('splits a mix of both correctly', async () => {
      await db.pickup_queue.add({
        ...baseEntry,
        clientOperationId: 'dead-1',
        manifestId: 'm-1',
        type: 'close_manifest',
        status: 'dead',
        lastError: 'MANIFEST_NOT_CLOSABLE',
      });
      await db.pickup_queue.add({
        ...baseEntry,
        clientOperationId: 'pending-same-manifest',
        manifestId: 'm-1',
        type: 'pickup_scan',
        status: 'pending',
      });
      // blockedCount = 1 dead + 1 same-manifest pending + 3 cross-user pending = 5
      const { result } = renderHook(() => useBlockedPickupEntries('op-1', 5));

      await waitFor(() => expect(result.current.status).toBe('ok'));
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.sameManifestBlockedCount).toBe(1);
      expect(result.current.crossUserBlockedCount).toBe(3);
    });

    // Escenario C, ronda 3 de review del PR #725 (bloqueante) — el seam
    // invertido. `manifestHasDeadEntry`/`manifestIsBlocked` EXCLUYEN
    // `manifest_photo` (B-1, spec-81 fase 5, ronda 3 del PR #712): un
    // manifiesto cuyo ÚNICO `dead` es una foto no bloquea sus `pending`
    // reales — `getBlockedPickupCount` no las cuenta. Sin el mismo filtro
    // aquí, `deadManifestIds` incluía manifiestos de fotos, y
    // `countPendingInManifests` contaba `pending` que NO están bloqueadas
    // de verdad — medido: `blockedCount=1, dead=1, same=4, cross(sin
    // clamp)=-4`, y el clamp a 0 escondía la inconsistencia en vez de
    // arreglarla.
    it('does not attribute same-manifest pending to a dead manifest_photo — a lost photo does not block pending scans', async () => {
      await db.pickup_queue.add({
        ...baseEntry,
        clientOperationId: 'dead-photo',
        manifestId: 'm-1',
        type: 'manifest_photo',
        status: 'dead',
        lastError: 'sheet_number collision',
      });
      await db.pickup_queue.bulkAdd(
        Array.from({ length: 4 }, (_, i) => ({
          ...baseEntry,
          clientOperationId: `pending-${i}`,
          manifestId: 'm-1',
          type: 'pickup_scan' as const,
          status: 'pending' as const,
        })),
      );
      // getBlockedPickupCount real, en este escenario, sólo cuenta la foto
      // muerta — las 4 pending NO están bloqueadas (manifestHasDeadEntry es
      // false para un manifiesto cuyo único dead es una foto).
      const { result } = renderHook(() => useBlockedPickupEntries('op-1', 1));

      await waitFor(() => expect(result.current.status).toBe('ok'));
      expect(result.current.sameManifestBlockedCount).toBe(0);
      expect(result.current.crossUserBlockedCount).toBe(0);
    });
  });

  // Ronda 3 de review del PR #725 — este clamp es un guard de CARRERA real
  // entre dos lecturas independientes (`blockedCount` de `useSyncQueue`,
  // su propio poll, contra esta lectura, más reciente), NO el arreglo del
  // seam invertido de arriba (escenario C): ese se corrige filtrando ANTES
  // de derivar `deadManifestIds`, no clampando después. Con ese filtro en
  // su sitio, este escenario sólo puede producirse por timing entre dos
  // `useEffect` distintos leyendo la misma cola en instantes distintos —
  // sigue siendo real (dos `setInterval`/efectos separados, sin lectura
  // atómica conjunta), sólo que ya no es lo único que evita ver el bug de
  // tipos.
  it('clamps crossUserBlockedCount to 0 when a stale blockedCount is smaller than what this read finds', async () => {
    await db.pickup_queue.bulkAdd([
      { ...baseEntry, clientOperationId: 'dead-1', manifestId: 'm-1', type: 'close_manifest', status: 'dead', lastError: 'MANIFEST_NOT_CLOSABLE' },
      { ...baseEntry, clientOperationId: 'dead-2', manifestId: 'm-2', type: 'close_manifest', status: 'dead', lastError: 'MANIFEST_NOT_CLOSABLE' },
    ]);
    // blockedCount stale en 1, pero ya hay 2 dead reales.
    const { result } = renderHook(() => useBlockedPickupEntries('op-1', 1));

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.crossUserBlockedCount).toBe(0);
  });

  // Menor (ronda 2 de review del PR #725) — un mutante que quitara el
  // `setEntries([])` de la rama `idle` sobrevivía porque ningún test volvía
  // a `blockedCount: 0` DESPUÉS de haber cargado filas.
  it('clears stale entries and counts when blockedCount returns to 0', async () => {
    await db.pickup_queue.add({
      ...baseEntry,
      clientOperationId: 'a',
      type: 'pickup_scan',
      status: 'dead',
      lastError: 'MANIFEST_NOT_CLOSABLE',
    });
    const { result, rerender } = renderHook(
      ({ blockedCount }) => useBlockedPickupEntries('op-1', blockedCount),
      { initialProps: { blockedCount: 1 } },
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    rerender({ blockedCount: 0 });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.entries).toEqual([]);
    expect(result.current.sameManifestBlockedCount).toBe(0);
    expect(result.current.crossUserBlockedCount).toBe(0);
  });
});
