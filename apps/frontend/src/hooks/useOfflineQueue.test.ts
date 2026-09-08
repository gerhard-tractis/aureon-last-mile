/**
 * spec-81 fase 2 — el drenador de la cola offline de Recogida.
 *
 * Drena `pickup_queue` (spec-81 fase 1) al montar y al recuperar
 * `navigator.onLine`. FIFO estricto por manifiesto — un `close_manifest`
 * nunca puede salir antes que los escaneos que produjeron su conteo.
 * Retroceso exponencial con techo entre reintentos de una misma entrada.
 *
 * El envío real a la red se inyecta (`OfflineQueueSender`) — este hook no
 * conoce la forma de `pickup_scans` ni de `close_manifest`; sólo decide
 * cuándo algo se reclama, se confirma, se reintenta o se da por muerto. Eso
 * mantiene la lógica de orden y reintento pura y testeable sin Supabase.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import { enqueue, listPending } from '@/lib/offline/queue';
import { useOfflineQueue, type OfflineQueueSender } from './useOfflineQueue';

const OPERATOR_A = 'operator-a';
const MANIFEST_1 = 'manifest-1';

async function seed() {
  const first = await enqueue(db, {
    operatorId: OPERATOR_A,
    manifestId: MANIFEST_1,
    type: 'pickup_scan',
    payload: { barcode: 'SCAN-1' },
  });
  const second = await enqueue(db, {
    operatorId: OPERATOR_A,
    manifestId: MANIFEST_1,
    type: 'pickup_scan',
    payload: { barcode: 'SCAN-2' },
  });
  const close = await enqueue(db, {
    operatorId: OPERATOR_A,
    manifestId: MANIFEST_1,
    type: 'close_manifest',
    payload: { manifestId: MANIFEST_1, count: 2 },
  });
  return { first, second, close };
}

describe('useOfflineQueue', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
    vi.restoreAllMocks();
  });

  it('drains two scans and a close in strict FIFO order — the close goes last', async () => {
    const { first, second, close } = await seed();
    const sentOrder: string[] = [];
    const send: OfflineQueueSender = vi.fn(async (entry) => {
      sentOrder.push(entry.clientOperationId);
      return { outcome: 'sent' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(async () => {
      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
    });

    expect(sentOrder).toEqual([
      first.clientOperationId,
      second.clientOperationId,
      close.clientOperationId,
    ]);
  });

  it('drains again when navigator.onLine comes back — the online event, not just mount', async () => {
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, send));
    await waitFor(async () => {
      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
    });

    // A new scan arrives while offline, then signal returns.
    await enqueue(db, {
      operatorId: OPERATOR_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: { barcode: 'SCAN-3' },
    });
    window.dispatchEvent(new Event('online'));

    await waitFor(async () => {
      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: first.clientOperationId }),
    );
  });

  it('a 500 (retry) does not discard the entry — it stays queued for the next pass', async () => {
    const { first } = await seed();
    let calls = 0;
    const send: OfflineQueueSender = vi.fn(async (entry) => {
      calls += 1;
      if (entry.clientOperationId === first.clientOperationId && calls === 1) {
        return { outcome: 'retry', reason: '500 server error' };
      }
      return { outcome: 'sent' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(async () => {
      const stored = await db.pickup_queue.get(first.id!);
      expect(stored?.retryCount).toBe(1);
    });

    const stored = await db.pickup_queue.get(first.id!);
    expect(stored?.status).toBe('pending');
    expect(stored?.lastError).toBe('500 server error');
    expect(stored?.clientOperationId).toBe(first.clientOperationId);
  });

  it('a 409 the sender has confirmed is the operation already fully applied resolves the entry (sent)', async () => {
    // spec-81 fase 3 coordination (PR #678 review, 2026-09-08): the hook
    // itself never inspects HTTP status codes — it trusts whatever
    // OfflineQueueOutcome the injected sender returns. A 409 is only safe
    // to report as 'sent' once the sender has verified the FULL operation
    // landed (e.g. re-reading row counts for a batched multi-row insert),
    // never from the status code alone — see OfflineQueueSender's docstring.
    // This test fakes a sender that has already done that verification.
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async (entry) => {
      if (entry.clientOperationId === first.clientOperationId) {
        // Sender already confirmed: this client_operation_id's full
        // operation is present server-side. Resolved.
        return { outcome: 'sent' };
      }
      return { outcome: 'sent' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(async () => {
      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
    });

    // sent entries are purged by the drainer after a successful pass —
    // absence from pending AND absence from the table entirely both count
    // as "resolved", never "dead".
    const remaining = await db.pickup_queue.toArray();
    expect(remaining.find((e) => e.clientOperationId === first.clientOperationId)?.status).not.toBe(
      'dead',
    );
  });

  it('an irrecoverable business rejection dead-letters the entry instead of retrying forever', async () => {
    const { close } = await seed();
    const send: OfflineQueueSender = vi.fn(async (entry) => {
      if (entry.type === 'close_manifest') {
        return { outcome: 'dead', reason: 'MANIFEST_NOT_CLOSABLE' };
      }
      return { outcome: 'sent' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(async () => {
      const stored = await db.pickup_queue.get(close.id!);
      expect(stored?.status).toBe('dead');
    });

    const stored = await db.pickup_queue.get(close.id!);
    expect(stored?.lastError).toBe('MANIFEST_NOT_CLOSABLE');
  });

  it('reclaims stale (orphaned) claims before draining, on mount', async () => {
    // A previous tab claimed this entry and died before ever calling
    // markFailed/markSent — it must not sit invisible in `sending` forever.
    const { first } = await seed();
    await db.pickup_queue.update(first.id!, {
      status: 'sending',
      claimToken: 'zombie-token',
      lastAttemptAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ clientOperationId: first.clientOperationId }),
      );
    });
  });

  it('does nothing when operatorId is not known yet', async () => {
    await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(null, send));

    // Give any accidental async work a tick to run, then assert nothing did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send).not.toHaveBeenCalled();
  });
});
