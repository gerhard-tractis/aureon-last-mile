'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  db,
  getBlockedPickupCount,
  getPendingPickupCount,
  requestPersistentStorage,
  type ScanQueue,
} from '@/lib/db';
import { syncManager } from '@/lib/sync-manager';

/**
 * spec-54 — the offline scan queue, for the topbar chip and the Recepción
 * sync panel (mock 1e).
 *
 * Replaces the reading half of ConnectionStatusBanner, which was a fixed
 * full-width bar pinned over the top of the page. The handoff moves that
 * state into the topbar and into the panel beside the count, where the
 * operator is already looking.
 *
 * The wording rule from the handoff is enforced by the callers, not here:
 * a message says what happens to the operator's work, not that the network
 * is down.
 */

export type ConnectionState = 'online' | 'offline' | 'syncing';

export interface SyncQueueState {
  status: ConnectionState;
  /** Everything outstanding on this device: Recepción's `scan_queue` plus
   * Recogida's `pickup_queue`. What the topbar chip and header badges show —
   * they have no "retry" button tied to a single queue. */
  queuedCount: number;
  /** Outstanding rows in `scan_queue` only — what `recent` lists and what
   * `retryNow` (`syncManager.manualSync` → `getUnsynced`) can actually drain.
   * `SyncQueuePanel` must use this, not `queuedCount`: feeding it the
   * combined count would show a header number the list below and the
   * "Reintentar ahora" button can't back up (spec-81, ronda 3, H2). */
  scanQueueCount: number;
  /**
   * B3, ronda 2 de review del PR #679 — entradas de `pickup_queue` que
   * agotaron los reintentos con un rechazo de negocio irrecuperable
   * (`status === 'dead'`). Separado de `queuedCount` a propósito: no son
   * "todavía en cola", son un bloqueo que necesita ayuda humana, y
   * `SyncChip` no puede pintar eso en su verde de éxito.
   */
  blockedCount: number;
  /** Most recent scans, newest first — both queued and recently synced. */
  recent: ScanQueue[];
  retryNow: () => void;
  isRetrying: boolean;
}

/** How often to re-read Dexie while there is anything outstanding. */
const POLL_MS = 2_000;
const RECENT_LIMIT = 25;

/**
 * `operatorId` — spec-81 fase 2: `getPendingPickupCount` pasó de
 * device-global a por operador (ver "Alcance del contador" en el spec). Sin
 * un operador conocido no hay a quién atribuirle la cuenta de
 * `pickup_queue`, así que esta vista sólo suma `scan_queue` hasta que
 * `operatorId` llegue — normalmente un instante después del mount, cuando
 * `useOperatorId` resuelve la sesión.
 */
export function useSyncQueue(operatorId: string | null = null): SyncQueueState {
  const [status, setStatus] = useState<ConnectionState>('online');
  const [queuedCount, setQueuedCount] = useState(0);
  const [scanQueueCount, setScanQueueCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [recent, setRecent] = useState<ScanQueue[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);

  const read = useCallback(async () => {
    try {
      const rows = await db.scan_queue.orderBy('scanned_at').reverse().limit(RECENT_LIMIT).toArray();
      setRecent(rows);
      // spec-81 — the badge covers both queues that live in this device's
      // IndexedDB: Recepción's `scan_queue` and Recogida's `pickup_queue`.
      // Without the second term this reads 0 while Recogida scans wait for
      // signal (ronda 1 de review de spec-81 fase 1, B1).
      const [outstandingScans, outstandingPickups, blocked] = await Promise.all([
        db.scan_queue.filter((s) => !s.synced).count(),
        operatorId ? getPendingPickupCount(operatorId) : Promise.resolve(0),
        operatorId ? getBlockedPickupCount(operatorId) : Promise.resolve(0),
      ]);
      setScanQueueCount(outstandingScans);
      setQueuedCount(outstandingScans + outstandingPickups);
      setBlockedCount(blocked);
    } catch {
      // IndexedDB unavailable (private browsing, quota). The chip simply
      // reports the network state; it must never take the screen down.
    }
  }, [operatorId]);

  const retryNow = useCallback(() => {
    setIsRetrying(true);
    setStatus('syncing');
    syncManager
      .manualSync()
      .catch(() => {
        /* surfaced by the queue not draining, not by a toast */
      })
      .finally(() => {
        setIsRetrying(false);
        setStatus(navigator.onLine ? 'online' : 'offline');
        void read();
      });
  }, [read]);

  useEffect(() => {
    setStatus(navigator.onLine ? 'online' : 'offline');
    void read();
    // spec-81 fase 1, ronda 1 de review (M4) — best-effort: sin este
    // permiso, IndexedDB es "best-effort" y iOS Safari (no instalado) purga
    // a los 7 días sin interacción. Éste es el primer mount que escribe en
    // la cola de Recogida, así que es donde corresponde pedirlo.
    void requestPersistentStorage();

    const onOnline = () => {
      // Coming back online is exactly when the queue should drain, so the
      // operator does not have to know to press anything.
      setStatus('syncing');
      syncManager
        .manualSync()
        .catch(() => {})
        .finally(() => {
          setStatus('online');
          void read();
        });
    };
    const onOffline = () => setStatus('offline');

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [read]);

  useEffect(() => {
    // Only poll while something is outstanding or the link is down. Online
    // with an empty queue is the common case and should cost nothing.
    if (status === 'online' && queuedCount === 0) return;
    const id = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(id);
  }, [status, queuedCount, read]);

  return { status, queuedCount, scanQueueCount, blockedCount, recent, retryNow, isRetrying };
}
