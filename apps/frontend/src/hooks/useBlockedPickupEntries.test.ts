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
});
