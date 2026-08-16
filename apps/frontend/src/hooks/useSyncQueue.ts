'use client';

import { useCallback, useEffect, useState } from 'react';
import { db, type ScanQueue } from '@/lib/db';
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
  /** Scans written to the device and not yet accepted by the server. */
  queuedCount: number;
  /** Most recent scans, newest first — both queued and recently synced. */
  recent: ScanQueue[];
  retryNow: () => void;
  isRetrying: boolean;
}

/** How often to re-read Dexie while there is anything outstanding. */
const POLL_MS = 2_000;
const RECENT_LIMIT = 25;

export function useSyncQueue(): SyncQueueState {
  const [status, setStatus] = useState<ConnectionState>('online');
  const [queuedCount, setQueuedCount] = useState(0);
  const [recent, setRecent] = useState<ScanQueue[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);

  const read = useCallback(async () => {
    try {
      const rows = await db.scan_queue.orderBy('scanned_at').reverse().limit(RECENT_LIMIT).toArray();
      setRecent(rows);
      const outstanding = await db.scan_queue.filter((s) => !s.synced).count();
      setQueuedCount(outstanding);
    } catch {
      // IndexedDB unavailable (private browsing, quota). The chip simply
      // reports the network state; it must never take the screen down.
    }
  }, []);

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

  return { status, queuedCount, recent, retryNow, isRetrying };
}
