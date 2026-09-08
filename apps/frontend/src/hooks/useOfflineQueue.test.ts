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

  // M1 (checklist item) — same contract, `markFailed` side: mutating
  // `markFailed(db, next.id!, result.reason, token, …)` to pass `undefined`
  // instead of `token` left every existing test green. Without the token, a
  // late 500 from a zombie drainer whose claim already got reassigned by
  // `reclaimStale` would free the SECOND drainer's live claim back to
  // `pending`, letting a third send race the one already in flight.
  it('passes the real claim token to markFailed — a stale claim cannot free a newer one', async () => {
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async () => {
      await db.pickup_queue.update(first.id!, {
        status: 'sending',
        claimToken: 'other-drainers-token',
      });
      return { outcome: 'retry', reason: '500 server error' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const stored = await db.pickup_queue.get(first.id!);
    // A correctly-scoped markFailed is a no-op here (claim mismatch) — the
    // "other drainer's" claim must survive untouched, not get freed back to
    // pending with our retryCount/lastError stamped on it.
    expect(stored?.status).toBe('sending');
    expect(stored?.claimToken).toBe('other-drainers-token');
    expect(stored?.retryCount).toBe(0);
  });

  // M2, ronda 1 de review del PR #679 — mutar `nextBackoffAt(next.retryCount)`
  // a `undefined` dejaba 7/7 verdes: nada afirmaba sobre `nextAttemptAt`. La
  // cabecera de fase 2 promete "retroceso exponencial con techo" y hasta
  // ahora ningún test lo comprobaba.
  it('a retry schedules the next attempt with exponential backoff (1s for the first failure)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = new Date('2026-09-08T10:00:00.000Z');
      vi.setSystemTime(now);
      const { first } = await seed();
      const send: OfflineQueueSender = vi.fn(async (entry) => {
        if (entry.clientOperationId === first.clientOperationId) {
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
      // BASE_BACKOFF_MS (1000) * 2^0 (retryCount before this failure) = 1000ms.
      expect(stored?.nextAttemptAt).toBe('2026-09-08T10:00:01.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  // M2 — the gate this backoff exists for: an entry whose nextAttemptAt is
  // still in the future must NOT be resent early just because a drain pass
  // ran (mount, `online` event). Without this the exponential backoff is
  // computed and persisted but never actually honored.
  it('does not resend an entry whose nextAttemptAt is still in the future', async () => {
    const { first } = await seed();
    await db.pickup_queue.update(first.id!, {
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
      retryCount: 1,
      lastError: 'previous 500',
    });
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: first.clientOperationId }),
    );
    const stored = await db.pickup_queue.get(first.id!);
    expect(stored?.status).toBe('pending');
    expect(stored?.retryCount).toBe(1);
  });

  // M1, ronda 1 de review del PR #679 — mutar `markSent(db, next.id!, token)`
  // a `markSent(db, next.id!, 'bogus-token')` dejaba 7/7 verdes: ningún test
  // afirmaba que una entrada llegara de verdad a `sent` ni que desapareciera.
  // Con ese mutante, `markSent` es un no-op silencioso (el token no coincide
  // con `matchesClaim`) — la entrada queda `sending` para siempre, invisible
  // a `listPending` (que excluye `sending`), así que "pending.length === 0"
  // seguía pasando aunque nada se hubiera confirmado de verdad. Esta prueba
  // exige la tabla vacía tras un drenado exitoso — `sending` sin resolver no
  // puede esconderse detrás de esa aserción.
  it('a 409 the sender has confirmed is the operation already fully applied purges the entry entirely (sent, then gone)', async () => {
    // spec-81 fase 3 coordination (PR #678 review, 2026-09-08): the hook
    // itself never inspects HTTP status codes — it trusts whatever
    // OfflineQueueOutcome the injected sender returns. A 409 is only safe
    // to report as 'sent' once the sender has verified the FULL operation
    // landed (e.g. re-reading row counts for a batched multi-row insert),
    // never from the status code alone — see OfflineQueueSender's docstring.
    // This test fakes a sender that has already done that verification.
    const { first, second, close } = await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(async () => {
      const remaining = await db.pickup_queue.toArray();
      expect(remaining).toHaveLength(0);
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: first.clientOperationId }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: second.clientOperationId }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: close.clientOperationId }),
    );
  });

  // M3, ronda 1 de review del PR #679 — la mitad que faltaba de este par: un
  // 409 que el sender NO puede confirmar como la operación completa (el caso
  // del propio choque de un lote multi-fila en su primer envío, ver el
  // docstring de `OfflineQueueSender`) debe reportar 'retry', no 'sent' —
  // tratarlo como enviado cerraría el manifiesto con un bulto menos sin que
  // nadie se entere.
  it('a 409 the sender could NOT confirm is the full operation stays pending (retry), never sent', async () => {
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async (entry) => {
      if (entry.clientOperationId === first.clientOperationId) {
        return { outcome: 'retry', reason: '409 — could not confirm full row count yet' };
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
    expect(stored?.status).not.toBe('sent');
  });

  // M1 (checklist item, ronda 1 de review del PR #679): "el drenador pasa el
  // claimToken" estaba marcado [x] sin ningún test que lo fijara — mutar
  // `markDead(db, next.id!, result.reason, token)` a
  // `markDead(db, next.id!, result.reason, undefined)` dejaba 7/7 verdes.
  // Sin token, `markDead` no exige que la reclamación siga siendo la
  // nuestra: un rechazo tardío puede matar la reclamación EN CURSO de otro
  // drenador que ganó `reclaimStale` mientras el primero seguía en vuelo —
  // exactamente el escenario que el guard de `matchesClaim` existe para
  // cerrar. Simulado aquí manipulando la fila a mitad de envío para
  // representar la reclamación del "segundo drenador".
  it('passes the real claim token to markDead — a stale claim cannot kill a newer one', async () => {
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async () => {
      // While "in flight", simulate another drainer having reclaimed this
      // same row under a different token (e.g. via reclaimStale racing this
      // one) — matchesClaim must see the mismatch and no-op.
      await db.pickup_queue.update(first.id!, {
        status: 'sending',
        claimToken: 'other-drainers-token',
      });
      return { outcome: 'dead', reason: 'PACKAGE_NOT_IN_MANIFEST' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    // Give markDead's write a tick to land either way.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const stored = await db.pickup_queue.get(first.id!);
    expect(stored?.status).not.toBe('dead');
    expect(stored?.claimToken).toBe('other-drainers-token');
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

  // B3, ronda 1 de review del PR #679: `listPending` excluye `dead` — así
  // que sin este guard, un escaneo muerto simplemente desaparece de la cola
  // y el `close_manifest` detrás de él pasa a la cabeza en la SIGUIENTE
  // pasada, cerrando el manifiesto con un bulto menos del que el operario
  // contó. El FIFO estricto por manifiesto (spec-81, "Orden: FIFO estricto
  // por manifiesto") existía sólo para la rama `retry`, no para `dead`.
  it('a dead scan blocks the close_manifest behind it in the same manifest — it never drains', async () => {
    const { first, second, close } = await seed();
    const sentOrder: string[] = [];
    const send: OfflineQueueSender = vi.fn(async (entry) => {
      if (entry.clientOperationId === first.clientOperationId) {
        return { outcome: 'dead', reason: 'PACKAGE_NOT_IN_MANIFEST' };
      }
      sentOrder.push(entry.type);
      return { outcome: 'sent' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await waitFor(async () => {
      const stored = await db.pickup_queue.get(first.id!);
      expect(stored?.status).toBe('dead');
    });

    // Give the drainer every chance to (wrongly) keep going past the dead
    // entry — if it does, `close_manifest` would show up in sentOrder.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sentOrder).not.toContain('close_manifest');
    const secondEntry = await db.pickup_queue.get(second.id!);
    const closeEntry = await db.pickup_queue.get(close.id!);
    expect(secondEntry?.status).toBe('pending');
    expect(closeEntry?.status).toBe('pending');
  });

  it('a manifest with a pre-existing dead entry stays blocked even across a fresh mount', async () => {
    const { first, close } = await seed();
    await db.pickup_queue.update(first.id!, {
      status: 'dead',
      lastError: 'PACKAGE_NOT_IN_MANIFEST',
    });
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, send));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: close.clientOperationId }),
    );
    const closeEntry = await db.pickup_queue.get(close.id!);
    expect(closeEntry?.status).toBe('pending');
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
