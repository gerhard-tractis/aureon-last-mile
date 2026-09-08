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
import * as queueLib from '@/lib/offline/queue';
import * as queueBlockingLib from '@/lib/offline/queue-blocking';
import {
  useOfflineQueue,
  retryBlockedManifest,
  MAX_RETRY_ATTEMPTS,
  type OfflineQueueSender,
} from './useOfflineQueue';

const OPERATOR_A = 'operator-a';
const USER_A = 'user-a';
const MANIFEST_1 = 'manifest-1';

async function seed() {
  const first = await enqueue(db, {
    operatorId: OPERATOR_A,
    userId: USER_A,
    manifestId: MANIFEST_1,
    type: 'pickup_scan',
    payload: { barcode: 'SCAN-1' },
  });
  const second = await enqueue(db, {
    operatorId: OPERATOR_A,
    userId: USER_A,
    manifestId: MANIFEST_1,
    type: 'pickup_scan',
    payload: { barcode: 'SCAN-2' },
  });
  const close = await enqueue(db, {
    operatorId: OPERATOR_A,
    userId: USER_A,
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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    // M-3, ronda 4 de review del PR #679 — uno de los 4 tests que fallaron
    // bajo caché fría + contención alta (2/5 ejecuciones de los 10 ficheros
    // del área juntos). Mismo ensanche que M6/M5 en este mismo archivo, misma
    // razón: contención de CPU entre ficheros en paralelo, no el mecanismo
    // bajo prueba.
    await waitFor(
      async () => {
        const pending = await listPending(db, OPERATOR_A);
        expect(pending).toHaveLength(0);
      },
      { timeout: 5_000 },
    );

    expect(sentOrder).toEqual([
      first.clientOperationId,
      second.clientOperationId,
      close.clientOperationId,
    ]);
  });

  it('drains again when navigator.onLine comes back — the online event, not just mount', async () => {
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));
    await waitFor(async () => {
      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
    });

    // A new scan arrives while offline, then signal returns.
    const scan3 = await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: { barcode: 'SCAN-3' },
    });
    window.dispatchEvent(new Event('online'));

    await waitFor(async () => {
      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
    });

    // m12, ronda 2 de review del PR #679 (menor) — la aserción original
    // comprobaba `send` con `first`, que ya se había enviado en el drenado
    // del MONTAJE, antes de que `SCAN-3` ni el evento `online` existieran:
    // pasaba igual con o sin un segundo drenado real. Lo que de verdad
    // discrimina "el evento `online` disparó otro drenado" es que SCAN-3
    // — encolado DESPUÉS del mount — se haya enviado.
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: scan3.clientOperationId }),
    );
  });

  // M4, ronda 3 de review del PR #679 (mayor) — este test no desmontaba ni
  // congelaba el reloj, y `drain()` deja un reintento REAL a +1000ms
  // (`nextBackoffAt`) tras la primera respuesta 'retry'. Si el tiempo real
  // entre el fin de este test y la limpieza automática (`afterEach(cleanup)`
  // en `src/test/setup.ts`) se acerca a 1000ms — un stall del runner, GC,
  // contención de CPU con el resto de la suite — ese timer dispara para
  // real, `send` devuelve 'sent' en su segunda llamada, y `purgeConfirmed`
  // borra la fila: no es un flake de contención de recursos ni la carrera
  // de M6, es un test con deadline de reloj real. Desmontar explícitamente
  // aquí, antes de leer el estado final, hace que el `clearTimeout` del
  // cleanup (B1) cancele ese timer de forma determinista sin depender de
  // cuánto tarde el runner en llegar al `afterEach` global.
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

    const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    await waitFor(async () => {
      const stored = await db.pickup_queue.get(first.id!);
      expect(stored?.retryCount).toBe(1);
    });

    unmount();

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

      renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    await waitFor(async () => {
      const stored = await db.pickup_queue.get(close.id!);
      expect(stored?.status).toBe('dead');
    });

    const stored = await db.pickup_queue.get(close.id!);
    expect(stored?.lastError).toBe('MANIFEST_NOT_CLOSABLE');
  });

  // M5, ronda 3 de review del PR #679 (mayor) — spec-81 declara el techo de
  // `retryCount` pendiente de esta fase. `markDead` sólo se invocaba desde
  // `outcome: 'dead'`, que sólo llega de los cuatro centinelas `permanent`;
  // nada más agotaba reintentos nunca. Con `MAX_BACKOFF_MS` topado, un error
  // desconocido reintentaba cada 30s para siempre, y `getPendingPickupCount`
  // lo contaba como `pending` — `SyncChip` pintaba verde de éxito "1 EN
  // COLA" indefinidamente. Mismo síntoma que B3 corrigió para `dead`: B2 lo
  // movió de `dead` a `pending` en vez de eliminarlo.
  it('M5 — a persistent transient error exhausts retries and dead-letters instead of retrying forever', async () => {
    const { first } = await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({
      outcome: 'retry',
      reason: 'unknown 42501',
    }));

    const { result } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    // Mount's own drain pass produces the first failure for real.
    //
    // M-3, ronda 4 de review del PR #679 — este test aparece en la lista de
    // 4 fallando bajo caché fría + contención alta (los 10 ficheros del área
    // juntos, 2/5 ejecuciones). Diagnosticado, no etiquetado "flaky": el
    // trabajo real aquí (fake-indexeddb) es de escala de microtarea, pero el
    // `waitFor` de la línea de abajo usaba el timeout por defecto (1000ms) —
    // el mismo margen que M6 (más abajo en este archivo) ya había tenido que
    // ensanchar por la misma razón (contención de CPU entre ficheros de test
    // corriendo en paralelo bajo `--pool=forks`, no un fallo del mecanismo
    // bajo prueba). Mismo ensanche, misma razón.
    await waitFor(
      async () => {
        const stored = await db.pickup_queue.get(first.id!);
        expect(stored?.retryCount).toBe(1);
      },
      { timeout: 5_000 },
    );

    // M-3, ronda 4 de review del PR #679 — diagnóstico del fallo real (no
    // sólo "flaky"): la primera falla de mount deja un `setTimeout` REAL de
    // 1000ms vivo (`scheduleRetry`, `nextBackoffAt(0)`), y nada lo cancela
    // hasta desmontar. Con 9 vueltas más de `drainNow()` conduciendo el
    // resto de los reintentos —cada una rápida en circunstancias normales,
    // pero bajo la contención de CPU real de correr los 10 ficheros del área
    // en paralelo, el conjunto puede tardar más de esos 1000ms—, ese timer
    // de fondo puede disparar A MITAD del bucle manual, competir por
    // `drainingRef` con la llamada manual en curso, y hacer que esa vuelta
    // sea un no-op (`rerunRequestedRef` en vez de una pasada real) — 9
    // oportunidades de colisión eran, medido, suficientes para que 20
    // vueltas no bastaran siempre. La costura no es el techo (correcto), es
    // que esta prueba dependía de 9 pasadas reales sucesivas SIN colisión.
    //
    // Arreglo real: sembrar `retryCount` cerca del techo directamente reduce
    // a UNA sola pasada real necesaria — el propio test ya declara que mide
    // "que el techo existe, no el temporizado del backoff" (comentario
    // original de M2), así que conducir cada paso intermedio nunca fue parte
    // de lo que esto necesitaba probar. El bucle de abajo sigue siendo una
    // red de seguridad (idempotente si una vuelta se pierde por la misma
    // colisión), pero ahora sólo necesita UNA vuelta que sí llegue a
    // ejecutarse de verdad, no nueve.
    await db.pickup_queue.update(first.id!, { retryCount: MAX_RETRY_ATTEMPTS - 1 });

    for (let i = 0; i < 20; i++) {
      const stored = await db.pickup_queue.get(first.id!);
      if (stored?.status === 'dead') break;
      await db.pickup_queue.update(first.id!, { nextAttemptAt: null });
      await result.current.drainNow();
    }

    const stored = await db.pickup_queue.get(first.id!);
    expect(stored?.status).toBe('dead');
    expect(stored?.lastError).toMatch(/unknown 42501/);
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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    // M-3, ronda 4 de review del PR #679 — uno de los 4 tests que fallaron
    // bajo caché fría + contención alta. Mismo ensanche, misma razón que los
    // otros tres en este archivo.
    await waitFor(
      async () => {
        const stored = await db.pickup_queue.get(first.id!);
        expect(stored?.status).toBe('dead');
      },
      { timeout: 5_000 },
    );

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

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

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ clientOperationId: first.clientOperationId }),
      );
    });
  });

  // M6, ronda 2 de review del PR #679 (mayor): `if (!operatorId || !userId
  // || drainingRef.current) return;` no reprogramaba nada en la rama
  // `drainingRef.current` — un evento `online` (o un reintento programado)
  // que llega mientras un `drain()` ya está corriendo se perdía sin dejar
  // rastro. Con señal intermitente los eventos `online` son frecuentes; esa
  // entrada no se reintentaba hasta el próximo `online` o hasta reabrir la
  // PWA.
  it('M6 — an online event that arrives mid-drain is not lost: a manifest enqueued during that drain still gets picked up', async () => {
    const MANIFEST_2 = 'manifest-2';
    let releaseFirstSend: (() => void) | undefined;
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });

    const firstEntry = await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: { barcode: 'FIRST' },
    });

    const sent: string[] = [];
    let injectedSecondEntry: Awaited<ReturnType<typeof enqueue>> | undefined;

    const send: OfflineQueueSender = vi.fn(async (entry) => {
      sent.push(entry.clientOperationId);
      if (entry.clientOperationId === firstEntry.clientOperationId) {
        // While THIS drain pass is still in flight (its manifestIds are
        // already fixed), a second manifest's entry arrives and an
        // `online` event fires. Neither can be seen by the running pass —
        // only the rerun that M6 adds picks them up once it finishes.
        injectedSecondEntry = await enqueue(db, {
          operatorId: OPERATOR_A,
          userId: USER_A,
          manifestId: MANIFEST_2,
          type: 'pickup_scan',
          payload: { barcode: 'SECOND' },
        });
        window.dispatchEvent(new Event('online'));
        await firstSendGate;
      }
      return { outcome: 'sent' };
    });

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    // Ronda 3 de review del PR #679 — observed timing out at the default
    // 1000ms under heavy contention from other test files running in
    // parallel (`--pool=forks`); this test's own work (the gated send plus
    // a real IndexedDB write) is not the bottleneck, CPU contention across
    // files is. Widen the margin rather than fake the clock — the gate
    // itself (`firstSendGate`) is real async coordination this test relies
    // on to interleave the injected second manifest correctly.
    await waitFor(() => expect(sent).toContain(firstEntry.clientOperationId), { timeout: 5_000 });
    releaseFirstSend?.();

    await waitFor(() => {
      expect(injectedSecondEntry).toBeDefined();
      expect(sent).toContain(injectedSecondEntry!.clientOperationId);
    });
  });

  // B1, ronda 3 de review del PR #679 (bloqueante) — `scheduleRetry`
  // reasigna `timersRef.current` a un array NUEVO cuando el primer timer
  // dispara (m10, ronda 2). El efecto de montaje captura `timersRef.current`
  // en una variable local (`const timers = timersRef.current`) ANTES de que
  // eso ocurra; su cleanup limpia esa referencia vieja, no la actual. Un
  // segundo reintento programado DESPUÉS de que el primero disparó queda en
  // el array nuevo, invisible para la limpieza — desmontar no lo cancela.
  // Escenario real: A cierra sesión entre el primer y el segundo reintento
  // de un `close_manifest` suyo; B entra; el timer huérfano de A dispara
  // igual, ejecutando el closure viejo de `drain` (operatorId/userId de A)
  // contra el cliente Supabase actual (sesión de B) — el cierre de A queda
  // firmado con el nombre de B.
  it('B1 — unmounting after the first scheduled retry fires cancels the second one too', async () => {
    const { first } = await seed();
    let calls = 0;
    const send: OfflineQueueSender = vi.fn(async () => {
      calls += 1;
      return { outcome: 'retry', reason: `attempt ${calls}` };
    });

    const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    // Mount's drain pass fails once (retryCount 0 -> 1s backoff scheduled).
    await waitFor(() => expect(calls).toBe(1));

    // Let that FIRST retry timer actually fire — this is the timer whose
    // callback reassigns `timersRef.current` (m10's array filter). This is
    // the moment B1 strands the mount effect's captured cleanup reference.
    await waitFor(() => expect(calls).toBe(2), { timeout: 2_000 });

    // Give the in-flight drain() pass a moment to fully settle (markFailed +
    // purgeConfirmed + scheduleRetry for the SECOND backoff) before
    // unmounting — otherwise this test would be racing `mountedRef`'s guard
    // instead of exercising the timer-identity bug B1 is actually about.
    // That race is real and is exactly why `mountedRef` exists (see its
    // docstring) — it just isn't what THIS test is asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A second retry (2s backoff, retryCount 1 -> 2^1) is now scheduled in
    // the NEW array. Unmount before it fires: a correct cleanup must cancel
    // it regardless of which array it landed in.
    unmount();
    void first;

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    expect(calls).toBe(2);
  }, 10_000);

  // B1 (seguimiento) — la mitad de la carrera que el test de arriba no
  // ejercita: un `drain()` que sigue en vuelo EN EL MOMENTO del desmontaje
  // puede llamar a `scheduleRetry` DESPUÉS de que el cleanup ya corrió (el
  // cleanup lee `timersRef.current` en el momento en que se ejecuta — no
  // puede limpiar un timer que todavía no existe). Sin `mountedRef`, ese
  // timer tardío queda huérfano para siempre: nada volverá a limpiarlo.
  it('B1 (seguimiento) — a scheduleRetry call that lands after unmount (drain() still in flight) never runs', async () => {
    const { first } = await seed();
    let calls = 0;
    let releaseSend: (() => void) | undefined;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const send: OfflineQueueSender = vi.fn(async () => {
      calls += 1;
      await sendGate;
      return { outcome: 'retry', reason: 'still offline' };
    });

    const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    await waitFor(() => expect(calls).toBe(1));

    // Unmount WHILE send() is still pending — markFailed/purgeConfirmed/
    // scheduleRetry for this failure haven't run yet.
    unmount();
    void first;
    releaseSend?.();

    // Give the in-flight drain() every chance to finish and call
    // scheduleRetry despite the unmount.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // If a timer leaked, it would fire well within this window (backoff for
    // the first failure is 1s) and drive a second send.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(calls).toBe(1);
  }, 10_000);

  // B2, ronda 3 de review del PR #679 (bloqueante) — `drainManifest` sale
  // por `manifestHasDeadEntry` ANTES de mirar `nextAttemptAt`, pero el
  // `remaining` que `drain()` usa para reprogramar el próximo intento sigue
  // incluyendo esa entrada. Si su `nextAttemptAt` ya venció, `delay === 0`
  // -> `drain()` inmediato -> mismo estado -> 0 otra vez. Sin techo, sin
  // salida: medido en el review, ~49 pasadas por segundo, cero envíos.
  it('B2 — does not busy-loop rescheduling at 0ms when a manifest is blocked by a dead entry', async () => {
    const { first, second } = await seed();
    // `first` is dead — blocks the whole manifest (manifestHasDeadEntry).
    await db.pickup_queue.update(first.id!, {
      status: 'dead',
      lastError: 'PACKAGE_NOT_IN_MANIFEST',
    });
    // `second` is still pending, with a backoff that already expired — this
    // is what feeds `soonest` a `delay === 0` on every pass, forever, if the
    // blocked manifest isn't excluded before computing it.
    await db.pickup_queue.update(second.id!, {
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      retryCount: 1,
    });

    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));
    const listPendingSpy = vi.spyOn(queueLib, 'listPending');

    const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    unmount();

    // Blocked manifest — the drainer must never touch anything in it.
    expect(send).not.toHaveBeenCalled();
    // A correct drainer settles after a handful of passes (mount, and maybe
    // one rerun) and stops rescheduling once it recognizes nothing in
    // `remaining` can make progress. A busy loop at delay=0 produced ~49
    // passes/second in the review's measurement — bound this generously
    // below that to catch a regression without being timing-flaky.
    expect(listPendingSpy.mock.calls.length).toBeLessThan(15);
  });

  it('does nothing when operatorId is not known yet', async () => {
    await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(null, USER_A, send));

    // Give any accidental async work a tick to run, then assert nothing did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when userId is not known yet, even with a known operatorId', async () => {
    await seed();
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, null, send));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send).not.toHaveBeenCalled();
  });

  // B4, ronda 2 de review del PR #679 (bloqueante) — el escenario probado
  // por el reviewer: un teléfono de muelle compartido. El conductor A
  // firma sin señal → encolado bajo su propio userId. A cierra sesión; el
  // mozo B, de la MISMA empresa (mismo operatorId), abre la app. Antes de
  // este fix, `AppLayout` montaba un único drenador por `operatorId` — la
  // sesión de B drenaba (y enviaba) la entrada de A. El servidor deriva
  // `signature_operator_name` de `auth.uid()`: el cierre quedaba firmado
  // con el nombre de B sobre la firma dibujada de A.
  describe('scoped by (operatorId, userId) — B4', () => {
    const USER_B = 'user-b';

    it("never sends another user's entry under the same operator, even when it is the head of the FIFO", async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'close_manifest',
        payload: { manifestId: MANIFEST_1, signatures: { operator_signature: 'A-sig' } },
      });
      const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

      // User B's session mounts the drainer — same operator, different
      // person. A's entry must not be touched at all. 200ms of real wall
      // clock is orders of magnitude more than every chained drain pass
      // (mount's automatic one, plus any M6 rerun) needs to fully settle —
      // fake-indexeddb work is microtask-scale, not real-timer-scale, so
      // this is not a race against the fix, just a generous margin against
      // a false pass from asserting too early.
      renderHook(() => useOfflineQueue(OPERATOR_A, USER_B, send));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(send).not.toHaveBeenCalled();

      const [stillThere] = await listPending(db, OPERATOR_A, MANIFEST_1);
      expect(stillThere.status).toBe('pending');
      expect(stillThere.userId).toBe(USER_A);
    });

    // M3, ronda 3 de review del PR #679 (mayor) — la versión anterior de
    // este test CONSAGRABA el bug: afirmaba que B drenaba su propio escaneo
    // mientras el de A, encolado ANTES en el mismo manifiesto, esperaba
    // intacto. Eso rompe el FIFO entre usuarios — exactamente el argumento
    // del propio docstring de `manifestHasDeadEntry`: un `pending` por
    // delante en el mismo manifiesto es el mismo problema que un `dead` por
    // delante, sólo que temporal. Escenario real: A escanea 5 bultos sin
    // red y cierra sesión; B entra, escanea 3 y firma. El drenador de B NO
    // puede saltarse los 5 de A — el manifiesto se cerraría corto de lo que
    // el cliente firmó.
    it("a different user's earlier pending entry in the SAME manifest blocks this user's own entry behind it — no cross-user FIFO skip", async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'A-SCAN' },
      });
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'B-SCAN' },
      });
      const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

      renderHook(() => useOfflineQueue(OPERATOR_A, USER_B, send));
      // Give the drainer every chance to (wrongly) skip ahead — 200ms of
      // real wall clock is orders of magnitude more than every chained
      // drain pass needs to settle (see the sibling B4 test above for the
      // same margin reasoning).
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(send).not.toHaveBeenCalled();

      const remaining = await listPending(db, OPERATOR_A, MANIFEST_1);
      expect(remaining).toHaveLength(2);
      expect(remaining[0].userId).toBe(USER_A);
      expect(remaining[1].userId).toBe(USER_B);
    });

    it("eventually drains once the enqueuing user's own session mounts the drainer", async () => {
      const aEntry = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'close_manifest',
        payload: { manifestId: MANIFEST_1, signatures: { operator_signature: 'A-sig' } },
      });
      const sent: string[] = [];
      const send: OfflineQueueSender = vi.fn(async (entry) => {
        sent.push(entry.clientOperationId);
        return { outcome: 'sent' };
      });

      renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

      await waitFor(() => expect(sent).toEqual([aEntry.clientOperationId]));
    });
  });

  // Ronda 4 de review del PR #679 — las cuatro mediciones del reviewer,
  // reproducidas como tests deterministas ANTES de arreglar (ver el reporte
  // de la ronda). Los cuatro fallaban contra el código de la ronda 3.
  describe('ronda 4 — reproducciones deterministas de E1-E4', () => {
    const USER_B = 'user-b';

    // E1 — costura 2. Medido por el reviewer: "listPending passes in 1s: 90
    // sends: 0". Escenario exacto: A encola en M y su entrada queda
    // `sending` (pestaña muerta a mitad de envío); B drena lo suyo en M y
    // falla una vez (backoff vencido). `reclaimStale` (corre en el drain()
    // de B, no filtra por usuario) devuelve la entrada de A a `pending`, y
    // pasa a ser cabeza del FIFO — todavía "fresca" para el reclamo
    // cross-user (`CROSS_USER_RECLAIM_MS`), así que sigue bloqueando a B.
    // Sin costura 2 cerrada, el filtro de `remaining`/`soonest` sólo miraba
    // `manifestHasDeadEntry` (no este bloqueo), así que el backoff ya
    // vencido de la entrada de B seguía alimentando `soonest` con
    // `delay === 0` en cada pasada — spin sin techo.
    it('E1 — a manifest blocked by manifestBlockedForUser (not dead) does not busy-loop the retry scheduler', async () => {
      const aStuck = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'A-STUCK' },
      });
      await db.pickup_queue.update(aStuck.id!, {
        status: 'sending',
        claimToken: 'zombie-token',
        // Older than RECLAIM_STALE_MS (90s) so reclaimStale recovers it —
        // but nowhere near CROSS_USER_RECLAIM_MS (15min), so it keeps
        // blocking B once reclaimed back to `pending`.
        lastAttemptAt: new Date(Date.now() - 91_000).toISOString(),
      });
      const bOwn = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'B-OWN' },
      });
      // B's own entry already failed once, with an expired backoff — the
      // exact fuel that fed the busy loop before costura 2 closed.
      await db.pickup_queue.update(bOwn.id!, {
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
        retryCount: 1,
      });

      const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));
      // `listPending`, not `manifestHead` — `drain()` calls `listPending`
      // directly, in both the pre-costura-2 and post-costura-2 code, once
      // per pass to build `pending`/`remaining`. A pass count that spikes
      // under the bug and stays low after the fix shows up here regardless
      // of which internal helper the blocking check itself happens to call
      // — spying on `manifestHead` specifically would silently read 0 under
      // the OLD code (it doesn't exist there) and prove nothing.
      const listPendingSpy = vi.spyOn(queueLib, 'listPending');
      void queueBlockingLib;

      const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_B, send));

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      unmount();

      // Never touches anything — B is blocked behind A's (still-fresh)
      // entry the whole time.
      expect(send).not.toHaveBeenCalled();
      // Reviewer's own bound (measured ~45 passes/s under the bug): a
      // correct drainer settles after a handful of passes instead of
      // spinning at delay=0.
      expect(listPendingSpy.mock.calls.length).toBeLessThan(15);
    });

    // E2 — M-1. Medido por el reviewer: "sends after unmount: [ 'S1', 'S2',
    // 'close' ]" — el bucle `for(;;)` de `drainManifest` no consultaba
    // `mountedRef`, así que seguía enviando el resto del manifiesto después
    // de que el componente se desmontara (cerrar sesión).
    it("E2 — unmounting mid-manifest stops the drain loop before the next entry ever sends", async () => {
      const { first, second, close } = await seed();
      const sentIds: string[] = [];
      // A ref object, not a reassigned `let` — `unmountRef` itself is only
      // ever assigned once (`prefer-const` correctly objects to a `let`
      // that's genuinely assigned once, even across this forward-reference
      // gap between declaring the closure and mounting the component it
      // needs to unmount).
      const unmountRef: { current?: () => void } = {};
      const send: OfflineQueueSender = vi.fn(async (entry) => {
        sentIds.push(entry.clientOperationId);
        if (entry.clientOperationId === first.clientOperationId) {
          // Unmount right as the first entry's send is about to resolve —
          // before `drainManifest`'s loop gets a chance to claim `second`.
          unmountRef.current?.();
        }
        return { outcome: 'sent' };
      });

      const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));
      unmountRef.current = unmount;

      await waitFor(() => expect(sentIds).toContain(first.clientOperationId));
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(sentIds).toEqual([first.clientOperationId]);
      void second;
      void close;
    });

    // E3 — M-1, seguimiento. Medido por el reviewer: un `online` que llega
    // MIENTRAS `drain()` sigue en vuelo marca `rerunRequestedRef`; el
    // `finally` ejecutaba esa pasada nueva SIN mirar si el componente ya se
    // había desmontado — recogiendo incluso entradas encoladas DESPUÉS del
    // desmontaje, con el `send` (JWT) de la sesión que acaba de cerrar.
    it('E3 — a rerun requested mid-drain does not run after unmount, even for entries enqueued later', async () => {
      const { first } = await seed();
      let releaseFirst: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const send: OfflineQueueSender = vi.fn(async (entry) => {
        if (entry.clientOperationId === first.clientOperationId) {
          // Marks rerunRequestedRef: drain() is still in flight (drainingRef
          // is true) when this online event fires.
          window.dispatchEvent(new Event('online'));
          await gate;
        }
        return { outcome: 'sent' };
      });

      const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));
      await waitFor(() => expect(send).toHaveBeenCalled());

      unmount();
      releaseFirst?.();

      const afterUnmount = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'AFTER-UNMOUNT' },
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ clientOperationId: afterUnmount.clientOperationId }),
      );
    });

    // E4 — costura 1. Medido por el reviewer: 149s de backoff real (10
    // intentos) bastan para que una caída de señal en el muelle agote
    // `MAX_RETRY_ATTEMPTS` y `markDead` bloquee el manifiesto entero — la
    // promesa de `5f` ("se sube al recuperar señal") se vuelve falsa. Aquí
    // se conduce el mismo número de fallos vía `drainNow` (mismo patrón que
    // el test de M5 para el techo), pero con `outcome: 'offline'` en vez de
    // `'retry'`.
    it('E4 — a sustained offline outage never dead-letters the entry, and it drains once signal returns', async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'close_manifest',
        payload: { manifestId: MANIFEST_1 },
      });
      let offline = true;
      const send: OfflineQueueSender = vi.fn(async () =>
        offline
          ? { outcome: 'offline', reason: 'Sin conexión. Se subirá al recuperar señal.' }
          : { outcome: 'sent' },
      );

      const { result } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

      await waitFor(
        async () => {
          const stored = await db.pickup_queue.get(entry.id!);
          expect(stored?.retryCount).toBe(1);
        },
        { timeout: 5_000 },
      );

      // M-3, ronda 4 de review del PR #679 — mismo diagnóstico que M5: la
      // primera falla deja un `setTimeout` real de 1000ms vivo, y bajo la
      // contención de CPU de la suite completa (625 ficheros) una llamada
      // manual a `drainNow()` puede coincidir con ese timer disparando en
      // background — ambos compiten por `drainingRef`, y la que pierde es
      // un no-op (`rerunRequestedRef`), no un fallo del mecanismo bajo
      // prueba. Sembrar `retryCount` bien por encima de `MAX_RETRY_ATTEMPTS`
      // directamente (en vez de conducir 14 fallos reales uno a uno) hace
      // que ESTA aserción no dependa de que la llamada real se ejecute: si
      // se pierde, la entrada simplemente sigue `pending` — que es
      // exactamente lo que se afirma. Es además una prueba MÁS directa de lo
      // que E4 dice ("offline nunca cuenta contra el techo, sin importar
      // cuántos intentos lleve ya").
      await db.pickup_queue.update(entry.id!, { retryCount: 15, nextAttemptAt: null });
      await result.current.drainNow();

      const afterOutage = await db.pickup_queue.get(entry.id!);
      expect(afterOutage?.status).toBe('pending');
      expect(afterOutage?.retryCount).toBeGreaterThanOrEqual(10);

      // Signal returns — it must actually drain, exactly as `5f` promises.
      // A diferencia de arriba, esta aserción SÍ necesita que la llamada
      // real llegue a ejecutarse (el envío es el efecto bajo prueba) —
      // reintentar de forma acotada es seguro porque `drainNow()` es
      // idempotente: una pasada de más sobre una entrada ya `sent`/purgada
      // no tiene efecto.
      offline = false;
      for (let i = 0; i < 10; i++) {
        await db.pickup_queue.update(entry.id!, { nextAttemptAt: null }).catch(() => {});
        await result.current.drainNow();
        if ((await db.pickup_queue.get(entry.id!)) === undefined) break;
      }

      const afterSignalReturns = await db.pickup_queue.get(entry.id!);
      expect(afterSignalReturns).toBeUndefined(); // sent, then purged
    });

    // E5b — ronda 5 de review del PR #679 (bloqueante), el cuarto flanco.
    // `manifestHead` (`queue-blocking.ts`) incluye `sending` a propósito
    // (menor 2, ronda 4 — cierra la ventana de bloqueo cross-user). Pero
    // `claimPending` sólo reclama `status === 'pending'` y devuelve `null`
    // si no. Una cabeza `sending` PROPIA (huérfana — p. ej. abandonada por
    // el guard `isMounted` de M-1 tras un desmontaje a mitad de envío) no
    // está bloqueada por `manifestIsBlocked` (sus propias entradas nunca la
    // bloquean a una misma) — así que `manifestHead` la devuelve, sigue sin
    // ser reclamable, `continue`, y vuelta a empezar: bucle sin techo DENTRO
    // de esta misma pasada de `drain()`, y `drainingRef.current` nunca
    // vuelve a `false` porque el `for(;;)` nunca sale por `return`. Medido
    // por el reviewer: 1446 iteraciones/segundo, 0 envíos.
    it('E5b — an own orphaned sending head that is not yet reclaimable does not spin the loop forever', async () => {
      const stuckSending = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'STUCK-SENDING' },
      });
      // Recién abandonada — bien dentro de RECLAIM_STALE_MS (90s), así que
      // reclaimStale (que sólo corre al INICIO de una pasada de drain(), no
      // dentro del bucle) no la toca todavía.
      await db.pickup_queue.update(stuckSending.id!, {
        status: 'sending',
        claimToken: 'orphaned-token',
        lastAttemptAt: new Date().toISOString(),
      });
      const behindIt = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'close_manifest',
        payload: { manifestId: MANIFEST_1 },
      });

      const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));
      const manifestHeadSpy = vi.spyOn(queueBlockingLib, 'manifestHead');

      const { unmount } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      unmount();

      // Nunca reclamable dentro de esta pasada — nada se envía, y lo que
      // está detrás en el FIFO tampoco avanza.
      expect(send).not.toHaveBeenCalled();
      const behindEntry = await db.pickup_queue.get(behindIt.id!);
      expect(behindEntry?.status).toBe('pending');
      // Mismo criterio que E1/B2: un drenador correcto se detiene tras un
      // puñado de vueltas en vez de girar sin techo (medido bajo el bug:
      // 1446/s).
      expect(manifestHeadSpy.mock.calls.length).toBeLessThan(15);
    });

    // E8 — ronda 5 de review del PR #679 (bloqueante), la consecuencia de
    // E5b: como el bucle de `drainManifest` nunca sale por `return`,
    // `drainingRef.current` se queda `true` para siempre — así que
    // `drainNow()` y cualquier evento `online` posterior son no-ops
    // (`rerunRequestedRef.current = true; return;`). El escenario real:
    // cambio de turno en el muelle — un conductor cierra sesión con un
    // envío en vuelo (M-1 lo abandona en `sending`, huérfano), el
    // siguiente entra después. Sin el arreglo de E5b, ni siquiera esperar a
    // que `reclaimStale` pudiera recuperarla (una vez pasado
    // `RECLAIM_STALE_MS`) sirve de nada: `drainNow()` ya no hace nada.
    it('E8 — once the orphaned head becomes reclaimable, a later drainNow() actually resumes (drainingRef is not stuck)', async () => {
      const stuckSending = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: { barcode: 'STUCK-SENDING' },
      });
      await db.pickup_queue.update(stuckSending.id!, {
        status: 'sending',
        claimToken: 'orphaned-token',
        lastAttemptAt: new Date().toISOString(),
      });
      const behindIt = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'close_manifest',
        payload: { manifestId: MANIFEST_1 },
      });

      const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));
      const { result } = renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));

      // Deja que la pasada inicial se estabilice (bloqueada por la cabeza
      // no-reclamable, bajo el arreglo de E5b).
      await new Promise((resolve) => setTimeout(resolve, 100));

      // El tiempo pasa — la reclamación huérfana ya es lo bastante vieja
      // para que `reclaimStale` (`RECLAIM_STALE_MS`) la recupere en la
      // PRÓXIMA pasada de `drain()`.
      await db.pickup_queue.update(stuckSending.id!, {
        lastAttemptAt: new Date(Date.now() - 91_000).toISOString(),
      });
      await result.current.drainNow();

      await waitFor(
        async () => {
          const stored = await db.pickup_queue.get(behindIt.id!);
          expect(stored).toBeUndefined(); // sent, then purged
        },
        { timeout: 5_000 },
      );
    });
  });

  // M-1, ronda 5 de review del PR #679 (mayor) — `retryBlockedManifest`
  // despertaba al drenador con `window.dispatchEvent(new Event('online'))`.
  // Hay SIETE suscriptores reales de ese evento en la app (React Query's
  // `onlineManager`, `useSyncQueue`, `scanStore`, etc. — ver `Providers.tsx`,
  // `useSyncQueue.ts`, `scanStore.ts`). Tocar "REQUIERE AYUDA" sin señal de
  // verdad les mentía a todos: React Query reanudaba mutaciones pausadas y
  // refetcheaba contra un dispositivo sin cobertura, el chip pintaba
  // "online" en verde, Recepción se marcaba online — y nada se
  // autocorregía, porque el navegador nunca iba a emitir el `offline` real
  // que los devolviera a la realidad (el estado de red real no cambió).
  // Medido por el reviewer: `navigator.onLine = false` pero
  // `SyncChip.status === 'online'` y `onlineManager.isOnline() === true`
  // tras un solo tap.
  //
  // `PICKUP_QUEUE_WAKE_EVENT` es un evento propio, con un solo suscriptor
  // (este mismo hook) — "hay trabajo nuevo, no esperes al backoff" sin
  // fingir que la red volvió.
  it("M-1 — retryBlockedManifest wakes the drainer via a scoped event, not a real 'online' that lies to the rest of the app", async () => {
    const dead = await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });
    await db.pickup_queue.update(dead.id!, { status: 'dead' });
    const send: OfflineQueueSender = vi.fn(async () => ({ outcome: 'sent' }));

    renderHook(() => useOfflineQueue(OPERATOR_A, USER_A, send));
    // Let the initial (blocked-by-dead) pass settle before retrying.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send).not.toHaveBeenCalled();

    const unrelatedOnlineListener = vi.fn();
    window.addEventListener('online', unrelatedOnlineListener);
    try {
      await retryBlockedManifest(OPERATOR_A, MANIFEST_1);

      // The retry itself still works — the dead entry is revived and the
      // drainer actually resumes.
      await waitFor(() => expect(send).toHaveBeenCalled());
    } finally {
      window.removeEventListener('online', unrelatedOnlineListener);
    }

    // But nothing outside this hook — React Query's onlineManager,
    // useSyncQueue, scanStore, or anything else subscribed to the real
    // 'online' event — ever saw it fire.
    expect(unrelatedOnlineListener).not.toHaveBeenCalled();
  });

  // M-3, ronda 5 de review del PR #679 (mayor) — `blockedCount`
  // (`getBlockedPickupCount`) incluye ahora los `pending` bloqueados
  // cross-user (M-2), pero `retryBlockedManifest` sólo revive `dead`. Sin
  // que el llamador pueda distinguir "revivió algo" de "no había nada que
  // revivir", el operario toca "REQUIERE AYUDA" sobre un bloqueo cross-user
  // y no pasa nada — sin cambio, sin feedback. Devolver el conteo real deja
  // que la pantalla que monta el botón decida qué decir cuando es 0 (ver
  // `complete/[loadId]/page.tsx` y `scan/[loadId]/page.tsx`).
  it('M-3 — retryBlockedManifest returns how many dead entries it actually revived', async () => {
    const dead = await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });
    await db.pickup_queue.update(dead.id!, { status: 'dead' });

    const revived = await retryBlockedManifest(OPERATOR_A, MANIFEST_1);

    expect(revived).toBe(1);
  });

  it('M-3 — retryBlockedManifest returns 0 when the block is cross-user (nothing dead to revive)', async () => {
    // Blocked entirely by another user's fresh pending entry — no `dead`
    // anywhere in this manifest, so `retryDead` has nothing to do.
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: 'user-b',
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });

    const revived = await retryBlockedManifest(OPERATOR_A, MANIFEST_1);

    expect(revived).toBe(0);
  });
});
