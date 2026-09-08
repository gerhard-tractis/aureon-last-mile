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

/**
 * M5, ronda 3 de review del PR #679 (mayor) — spec-81 fase 3 (M-4 residual)
 * y spec-81 fase 2 (checklist original) dejan escrito que este techo queda
 * pendiente de esta fase. Sin él, `markDead` sólo se alcanza vía los cuatro
 * centinelas `permanent`/`idempotent` que clasifica el sender — un error
 * `transient` desconocido (un 42501 sin reconocer, un 409 de lote que el
 * sender nunca puede confirmar completo, M-4 de fase 3) reintenta cada
 * `MAX_BACKOFF_MS` para siempre. `getPendingPickupCount` cuenta eso como
 * `pending` y `SyncChip` lo pinta verde de éxito — el mismo síntoma que B3
 * corrigió para `dead` (B2 lo había movido de `dead` a `pending` en vez de
 * eliminarlo), reintroducido por cualquier `transient` sin techo.
 *
 * 10 intentos: con el backoff exponencial topado en `MAX_BACKOFF_MS`, eso
 * son ~1s+2s+4s+8s+16s+30s×5 ≈ 3 minutos de reintentos antes de rendirse —
 * suficiente para que una caída de señal de unos minutos en el muelle se
 * resuelva sola sin dar por muerta la entrada, pero sin reintentar de forma
 * indefinida un rechazo que nunca va a resolverse solo.
 */
const MAX_RETRY_ATTEMPTS = 10;

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
/**
 * B4, ronda 2 de review del PR #679 (bloqueante) — la cola estaba acotada
 * por inquilino (`operatorId`), no por persona. En un teléfono de muelle
 * compartido, dos conductores DE LA MISMA empresa pueden encolar en
 * sesiones sucesivas; sin este filtro, la sesión de B drenaba (y enviaba,
 * con la firma de A) la entrada que A había encolado — `close_manifest`
 * deriva `signature_operator_name` de `auth.uid()` en el servidor.
 *
 * `manifestHasDeadEntry` (más abajo) sigue sin filtrar por usuario a
 * propósito: un escaneo `dead` en un manifiesto es un problema del
 * MANIFIESTO (una carga con un conteo que no cuadra), no de quién lo
 * encoló — debe bloquear a cualquiera que intente cerrar ese manifiesto,
 * no sólo a quien produjo el `dead`. `reclaimStale`/`purgeConfirmed`
 * (drain(), más abajo) tampoco filtran por usuario: no tocan datos de
 * negocio (sólo el estado de la reclamación / entradas ya confirmadas), así
 * que reclamar o purgar la entrada de otro usuario no puede producir el
 * problema de custodia que este filtro existe para cerrar — y sólo ESTE
 * filtro decide qué se reclama y envía de verdad.
 */
function ownEntries(entries: PickupQueueEntry[], userId: string): PickupQueueEntry[] {
  return entries.filter((entry) => entry.userId === userId);
}

/**
 * M3, ronda 3 de review del PR #679 (mayor) — guarda hermana de
 * `manifestHasDeadEntry`. Su propio docstring da el argumento: un `pending`
 * de OTRO usuario por delante en el FIFO de este manifiesto es el mismo
 * problema que un `dead` por delante, sólo que temporal — dejarlo pasar
 * (como hacía `ownEntries` filtrando ANTES de mirar quién es la cabeza real)
 * rompe el FIFO entre usuarios: A escanea 5 bultos sin red y cierra sesión;
 * B entra, escanea 3 y firma; el drenador de B no puede saltarse los 5 de A
 * — el manifiesto se cerraría corto de lo que el cliente firmó.
 *
 * `listPending(db, operatorId, manifestId)` sin filtrar por usuario ya viene
 * en orden FIFO estricto (ver su docstring); su primer elemento es la
 * cabeza real de este manifiesto sea de quien sea. Si esa cabeza no es de
 * `userId`, esta sesión no puede tocar nada en el manifiesto todavía.
 */
async function manifestBlockedForUser(
  operatorId: string,
  manifestId: string,
  userId: string,
): Promise<boolean> {
  const [globalHead] = await listPending(db, operatorId, manifestId);
  return globalHead !== undefined && globalHead.userId !== userId;
}

async function drainManifest(
  operatorId: string,
  userId: string,
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

    // M3 — un `pending` de otro usuario por delante bloquea igual (ver
    // docstring de `manifestBlockedForUser`).
    if (await manifestBlockedForUser(operatorId, manifestId, userId)) return;

    const [next] = ownEntries(await listPending(db, operatorId, manifestId), userId);
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
    // M5, ronda 3 de review del PR #679 (mayor) — un 'retry' que ya agotó
    // `MAX_RETRY_ATTEMPTS` deja de ser "reintentable": se da por muerta en
    // vez de reprogramar otro backoff que nunca la resolvería sola. Sin
    // esto, un `transient` desconocido reintenta cada `MAX_BACKOFF_MS` para
    // siempre y `getPendingPickupCount` lo sigue contando como `pending`.
    if (next.retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
      await markDead(
        db,
        next.id!,
        `retries exhausted after ${MAX_RETRY_ATTEMPTS} attempts: ${result.reason}`,
        token,
      );
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

export function useOfflineQueue(
  operatorId: string | null,
  userId: string | null,
  send: OfflineQueueSender,
) {
  const drainingRef = useRef(false);
  // M6, ronda 2 de review del PR #679 (mayor): un reintento programado
  // (`scheduleRetry`) o un evento `online` que llega MIENTRAS `drain()` ya
  // está corriendo salía por el guard `drainingRef.current` de abajo sin
  // dejar rastro — nada volvía a programar ese intento. Con señal
  // intermitente los eventos `online` son frecuentes, así que esa entrada
  // no se reintentaba hasta el próximo `online` o hasta reabrir la PWA. En
  // vez de descartar la llamada, se marca "hace falta otra pasada" y el
  // propio `drain()` la ejecuta al terminar la que está en curso.
  const rerunRequestedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scheduleRetry = useCallback((delayMs: number, run: () => void) => {
    const timer = setTimeout(() => {
      // m10, ronda 2 de review del PR #679 (menor): sin esto, `timersRef`
      // crece sin límite — un timer ya disparado nunca se quitaba del
      // array, así que una sesión larga con muchos reintentos acumulaba
      // referencias muertas indefinidamente.
      timersRef.current = timersRef.current.filter((t) => t !== timer);
      run();
    }, delayMs);
    timersRef.current.push(timer);
  }, []);

  const drain = useCallback(async () => {
    if (!operatorId || !userId) return;
    if (drainingRef.current) {
      rerunRequestedRef.current = true;
      return;
    }
    drainingRef.current = true;
    try {
      // Checklist de fase 2: recuperar reclamaciones huérfanas ANTES de
      // listar pendientes — una pestaña muerta a mitad de envío deja una
      // entrada en `sending` que, sin esto, `listPending` nunca vuelve a
      // ofrecer.
      await reclaimStale(db, operatorId, RECLAIM_STALE_MS);

      // B4, ronda 2 de review del PR #679 (bloqueante) — sólo los
      // manifiestos con AL MENOS una entrada de ESTA sesión entran al
      // drenado; `drainManifest` filtra de nuevo por `userId` en cada
      // vuelta (ver `ownEntries`), así que ninguna entrada de otro usuario
      // se reclama ni se envía nunca, aunque comparta manifiesto.
      const pending = ownEntries(await listPending(db, operatorId), userId);
      const manifestIds = Array.from(new Set(pending.map((e) => e.manifestId)));
      // FIFO estricto DENTRO de un manifiesto; entre manifiestos distintos
      // puede ir en paralelo (spec-81, "Orden: FIFO estricto por
      // manifiesto").
      await Promise.all(manifestIds.map((id) => drainManifest(operatorId, userId, id, send)));

      // `purgeConfirmed` no filtra por usuario — borra `sent` del operador
      // entero. Es sólo limpieza de filas ya confirmadas por el servidor;
      // no hay dato de negocio ni custodia que proteger ahí.
      await purgeConfirmed(db, operatorId);

      // Si algo quedó en backoff, no esperar a un nuevo evento `online` —
      // reprogramar un intento cuando el más próximo esté debido. Sólo
      // sobre las entradas de esta sesión: reprogramar por la de otro
      // usuario no adelantaría nada (`drainManifest` las sigue ignorando).
      //
      // B2, ronda 3 de review del PR #679 (bloqueante) — `drainManifest`
      // sale por `manifestHasDeadEntry` ANTES de mirar `nextAttemptAt`, pero
      // `listPending` sigue devolviendo esa entrada `pending` igual. Si su
      // backoff ya venció, sin este filtro `soonest` calcula `delay === 0`
      // en cada pasada — `drain()` se reprograma inmediato, repite el mismo
      // estado, y vuelve a dar 0 — sin techo, sin salida (medido: ~49
      // pasadas/s, 0 envíos). Se excluyen aquí las entradas cuyo manifiesto
      // está bloqueado: nada que este drenador vaya a poder avanzar debe
      // alimentar el temporizador de reintento.
      const remainingAll = ownEntries(await listPending(db, operatorId), userId);
      const remainingManifestIds = Array.from(new Set(remainingAll.map((e) => e.manifestId)));
      const blockedManifestIds = new Set(
        (
          await Promise.all(
            remainingManifestIds.map(async (id) => ({
              id,
              blocked: await manifestHasDeadEntry(db, operatorId, id),
            })),
          )
        )
          .filter((m) => m.blocked)
          .map((m) => m.id),
      );
      const remaining = remainingAll.filter((e) => !blockedManifestIds.has(e.manifestId));
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
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        void drain();
      }
    }
  }, [operatorId, userId, send, scheduleRetry]);

  useEffect(() => {
    void drain();

    const onOnline = () => void drain();
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('online', onOnline);
      // B1, ronda 3 de review del PR #679 (bloqueante) — leer
      // `timersRef.current` AQUÍ, en vez de capturarlo en una variable local
      // al montar el efecto. `scheduleRetry` reasigna `timersRef.current` a
      // un array nuevo cuando el primer timer dispara (m10, ronda 2); una
      // variable capturada al montar queda apuntando al array viejo en
      // cuanto eso ocurre, y un segundo reintento programado DESPUÉS nunca
      // se cancela al desmontar. Leer la ref en el momento de la limpieza
      // siempre ve el array vivo, sin importar cuántas veces se reasignó.
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [drain]);

  return { drainNow: drain };
}
