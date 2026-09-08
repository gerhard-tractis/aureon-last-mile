'use client';

import { useCallback, useEffect, useRef } from 'react';
import { db, type PickupQueueEntry } from '@/lib/db';
import {
  claimPending,
  listPending,
  manifestHasDeadEntry,
  markDead,
  markFailed,
  markSent,
  purgeConfirmed,
  reclaimStale,
} from '@/lib/offline/queue';

/**
 * spec-81 fase 2 — el drenador de `pickup_queue`.
 *
 * Este hook no sabe llamar a Supabase: recibe un `OfflineQueueSender`
 * inyectado por la pantalla que lo monta, que ya conoce la forma de
 * `pickup_scans`/`close_manifest` y de sus RPCs. Lo único que este módulo
 * decide es CUÁNDO algo se reclama, se confirma, se reintenta o se da por
 * muerto — la parte que es igual para cualquier tipo de operación en la
 * cola, y la parte que sí necesita tests deterministas sin red real.
 */
export type OfflineQueueOutcome =
  | { outcome: 'sent' }
  | { outcome: 'retry'; reason: string }
  | { outcome: 'dead'; reason: string };

/**
 * Implementado por la pantalla que monta este hook — es quien conoce la
 * forma de `pickup_scans`/`close_manifest` y de sus RPCs.
 *
 * Contrato de `'sent'` — coordinación con spec-81 fase 3 (review del PR
 * #678, 2026-09-08): un HTTP 409 NO es automáticamente `'sent'`. Antes de
 * la clave compuesta `(operator_id, client_operation_id, package_id)` con
 * `NULLS NOT DISTINCT` que fase 3 añade, un lote de varias filas
 * (`usePickupScans.ts` inserta N filas — una por bulto — bajo un único
 * `clientOperationId` cuando el escaneo es a nivel de pedido) puede
 * devolver 409 en su **primer** envío, por chocar consigo mismo, no por
 * ser un reintento. Tratar ESE 409 como `'sent'` marcaría resuelto un
 * escaneo que nunca se guardó — el manifiesto queda corto exactamente en
 * el número que el cliente firma en `5f`, el fallo que esta cola existe
 * para impedir, invertido.
 *
 * `'sent'` debe significar "el servidor confirma que la operación
 * COMPLETA ya está aplicada" — no "recibí un código que suele significar
 * duplicado". Un sender contra `pickup_scans` que reciba 409 debería
 * releer cuántas filas hay para ese `client_operation_id` (barato) antes
 * de devolver `'sent'`, en vez de fiarse del código de estado a ciegas.
 * Con la clave compuesta de fase 3 en producción, un 409 vuelve a ser
 * limpio para `close_manifest` y para escaneos 1:1; el matiz de arriba
 * sigue aplicando a cualquier sender que escriba en lote.
 */
export type OfflineQueueSender = (entry: PickupQueueEntry) => Promise<OfflineQueueOutcome>;

/**
 * Debe superar el timeout de la petición HTTP que hace `send` — spec-81,
 * checklist de fase 2: si no, una petición lenta pero legítima en 2G se
 * reclama como huérfana antes de completarse y entra en un bucle
 * reclaim → resend → resend.
 *
 * B4, ronda 1 de review del PR #679 — la versión anterior (45s) se
 * justificaba con "un timeout de red típico de 20-30s" que **no existe en
 * este código**: `postgrest-js` no fija ningún timeout por su cuenta, así
 * que sin `abortSignal` el límite real era el default del `fetch` del
 * navegador (~300s) — 45s quedaba 6,7× por debajo, no por encima. La
 * corrección real es contractual, no un número más generoso: el sender
 * (`offlineQueueSender.ts`, `CLOSE_MANIFEST_TIMEOUT_MS`) ahora impone su
 * propio `AbortSignal.timeout(60_000)` sobre la llamada — así que ESTE
 * valor sólo necesita superar ESE, con margen. 90s deja 30s de margen sobre
 * los 60s del sender.
 */
const RECLAIM_STALE_MS = 90_000;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function nextBackoffAt(retryCountBeforeThisFailure: number): string {
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** retryCountBeforeThisFailure, MAX_BACKOFF_MS);
  return new Date(Date.now() + delay).toISOString();
}

/**
 * Drena un manifiesto entero, secuencialmente. FIFO estricto: nunca se pide
 * el siguiente elemento hasta que el anterior se resolvió (enviado,
 * reintentable-y-detenido, o muerto) — así un `close_manifest` nunca puede
 * salir antes que los escaneos que produjeron su conteo, y una entrada aún
 * no debida (backoff) no se salta a favor de la que viene después.
 */
async function drainManifest(
  operatorId: string,
  manifestId: string,
  send: OfflineQueueSender,
): Promise<void> {
  for (;;) {
    // B3, ronda 1 de review del PR #679: un escaneo `dead` en este
    // manifiesto bloquea TODO lo que va detrás, incluido `close_manifest` —
    // ver el docstring de `manifestHasDeadEntry`. Se comprueba en cada
    // vuelta, no sólo antes del bucle, para atrapar tanto un `dead` ya
    // persistido de una pasada anterior como uno que este mismo bucle
    // acaba de producir.
    if (await manifestHasDeadEntry(db, operatorId, manifestId)) return;

    const [next] = await listPending(db, operatorId, manifestId);
    if (!next) return;

    if (next.nextAttemptAt && Date.parse(next.nextAttemptAt) > Date.now()) {
      // Todavía en backoff — no reintentar antes de tiempo, y no adelantar
      // nada detrás en este manifiesto (FIFO). Un evento `online` posterior,
      // o el propio timer de retroceso más abajo, volverá a intentarlo.
      return;
    }

    const token = await claimPending(db, next.id!);
    if (!token) {
      // Otro drenador (el evento `online` y el mount disparando juntos al
      // salir de un túnel) ganó la reclamación primero. Reintentar la
      // cabeza de la cola: si sigue "sending" bajo el otro token, listPending
      // ya no la devuelve y el bucle avanza solo.
      continue;
    }

    let result: OfflineQueueOutcome;
    try {
      result = await send({ ...next, status: 'sending', claimToken: token });
    } catch (err) {
      result = { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
    }

    if (result.outcome === 'sent') {
      await markSent(db, next.id!, token);
      continue;
    }
    if (result.outcome === 'dead') {
      await markDead(db, next.id!, result.reason, token);
      continue;
    }
    // 'retry' — un 500, o la rama "sin conexión" (fetch rechaza casi al
    // instante). No la descarta: la deja `pending` con su reintento
    // contado, el motivo guardado y el siguiente intento programado con
    // retroceso exponencial y techo. Se detiene aquí — el resto del
    // manifiesto espera detrás de ésta, FIFO.
    await markFailed(db, next.id!, result.reason, token, nextBackoffAt(next.retryCount));
    return;
  }
}

export function useOfflineQueue(operatorId: string | null, send: OfflineQueueSender) {
  const drainingRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scheduleRetry = useCallback((delayMs: number, run: () => void) => {
    const timer = setTimeout(run, delayMs);
    timersRef.current.push(timer);
  }, []);

  const drain = useCallback(async () => {
    if (!operatorId || drainingRef.current) return;
    drainingRef.current = true;
    try {
      // Checklist de fase 2: recuperar reclamaciones huérfanas ANTES de
      // listar pendientes — una pestaña muerta a mitad de envío deja una
      // entrada en `sending` que, sin esto, `listPending` nunca vuelve a
      // ofrecer.
      await reclaimStale(db, operatorId, RECLAIM_STALE_MS);

      const pending = await listPending(db, operatorId);
      const manifestIds = Array.from(new Set(pending.map((e) => e.manifestId)));
      // FIFO estricto DENTRO de un manifiesto; entre manifiestos distintos
      // puede ir en paralelo (spec-81, "Orden: FIFO estricto por
      // manifiesto").
      await Promise.all(manifestIds.map((id) => drainManifest(operatorId, id, send)));

      await purgeConfirmed(db, operatorId);

      // Si algo quedó en backoff, no esperar a un nuevo evento `online` —
      // reprogramar un intento cuando el más próximo esté debido.
      const remaining = await listPending(db, operatorId);
      const soonest = remaining
        .map((e) => (e.nextAttemptAt ? Date.parse(e.nextAttemptAt) : null))
        .filter((t): t is number => t !== null)
        .sort((a, b) => a - b)[0];
      if (soonest !== undefined) {
        const delay = Math.max(soonest - Date.now(), 0);
        scheduleRetry(delay, () => void drain());
      }
    } finally {
      drainingRef.current = false;
    }
  }, [operatorId, send, scheduleRetry]);

  useEffect(() => {
    void drain();

    const onOnline = () => void drain();
    window.addEventListener('online', onOnline);

    const timers = timersRef.current;
    return () => {
      window.removeEventListener('online', onOnline);
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
  }, [drain]);

  return { drainNow: drain };
}
