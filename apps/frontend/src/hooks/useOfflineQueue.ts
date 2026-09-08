'use client';

import { useCallback, useEffect, useRef } from 'react';
import { db, type PickupQueueEntry } from '@/lib/db';
import {
  claimPending,
  listPending,
  markDead,
  markFailed,
  markSent,
  purgeConfirmed,
  reclaimStale,
  retryDead,
} from '@/lib/offline/queue';
import { manifestHead, manifestIsBlocked } from '@/lib/offline/queue-blocking';

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
  /**
   * Costura 1, ronda 4 de review del PR #679 — separado de `'retry'`. El
   * sender (`offlineQueueSender.ts`) ya distingue "el servidor devolvió
   * algo raro" (`transient`) de "el operario está en un sótano"
   * (`offline`) vía `classifyCloseManifestError`; hasta esta ronda ambos
   * colapsaban en el mismo `'retry'` al cruzar hacia este hook, y
   * `MAX_RETRY_ATTEMPTS` (más abajo) se aplicaba por igual a los dos. Medido
   * por el reviewer: 149s de backoff real (~10 intentos) bastan para que
   * una caída de señal de unos minutos en el muelle agote el techo,
   * `markDead` bloquee el manifiesto entero (`manifestHasDeadEntry`,
   * "deliberadamente permanente") y la promesa de `5f` ("se sube al
   * recuperar señal") deje de ser verdad. `offline` sigue reintentando con
   * el mismo retroceso exponencial que `transient` — lo único que cambia es
   * que nunca cuenta contra el techo ni llega a `dead` por su cuenta.
   */
  | { outcome: 'offline'; reason: string }
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
 * son ~1s+2s+4s+8s+16s+30s×5 ≈ 149s (medido, no los "~3 minutos" que este
 * docstring afirmaba antes de la ronda 4) de reintentos antes de rendirse —
 * suficiente para que un rechazo de servidor que nunca va a resolverse solo
 * deje de reintentar indefinidamente.
 *
 * Costura 1, ronda 4 de review del PR #679 — este techo sólo se aplica a
 * `outcome: 'retry'` (transient). `outcome: 'offline'` nunca lo cuenta ni
 * llega a `dead` por agotarlo — ver el docstring de `OfflineQueueOutcome` y
 * el `case 'offline'` en `drainManifest`. Antes de esta ronda, el sender
 * colapsaba ambas clases en `'retry'`, así que una caída de señal sostenida
 * en el muelle (el caso normal que este spec existe para cubrir) agotaba
 * el techo por pura ausencia de red en ~149s y bloqueaba el manifiesto
 * entero — medido por el reviewer.
 */
export const MAX_RETRY_ATTEMPTS = 10;

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
 * M-1, ronda 4 de review del PR #679 — `mountedRef` (más abajo) sólo
 * protegía los timers de reintento; `drainManifest` seguía enviando después
 * del desmontaje por otras dos vías, medidas por el reviewer: el bucle
 * `for(;;)` no consultaba `mountedRef` (E2: `sends after unmount` no vacío),
 * y `rerunRequestedRef` disparaba una pasada nueva tras el desmontaje (E3).
 * Riesgo real, no cosmético: `pickupQueueSender` (`AppLayout.tsx`) está
 * memoizado sobre un `createSPAClient()` que resuelve la sesión en el
 * MOMENTO de la petición — una pasada que sobrevive al desmontaje (cerrar
 * sesión) envía con el JWT que haya entonces: anónimo, expirado, o el del
 * siguiente conductor. Mismo riesgo de custodia que B1/B4.
 *
 * `isMounted` se comprueba antes de cada operación async que podría
 * sobrevivir al desmontaje: al inicio de cada vuelta del bucle, justo antes
 * de reclamar, y justo antes/después de `send()`. Si el componente ya se
 * desmontó a mitad de un `send()` en vuelo, esta función abandona sin
 * escribir el resultado — la entrada queda `sending`, huérfana, y
 * `reclaimStale` (en un futuro montaje) la recupera, exactamente el
 * mecanismo que ya existe para una pestaña que muere a mitad de envío.
 */
async function drainManifest(
  operatorId: string,
  userId: string,
  manifestId: string,
  send: OfflineQueueSender,
  isMounted: () => boolean,
): Promise<void> {
  for (;;) {
    if (!isMounted()) return;

    // Costura 2, ronda 4 de review del PR #679 — único predicado que decide
    // si el manifiesto puede avanzar (`dead` en cualquier lugar, o un
    // `pending`/`sending` de otro usuario por delante que aún no es
    // reclamable). Ver el docstring de `manifestIsBlocked`
    // (`lib/offline/queue-blocking.ts`) para por qué unificarlo con lo que
    // `drain()` usa para programar el próximo reintento es lo que cierra la
    // costura, no un parche más.
    if (await manifestIsBlocked(db, operatorId, manifestId, userId)) return;
    if (!isMounted()) return;

    // `manifestHead` — a diferencia de `listPending` filtrado por usuario —
    // devuelve la cabeza real del FIFO sea de quien sea. Una vez que
    // `manifestIsBlocked` confirma que esta sesión puede avanzar, esa cabeza
    // es procesable: o es de esta sesión, o es de otro usuario pero ya
    // reclamable (decisión del usuario, ronda 4 — ver `CROSS_USER_RECLAIM_MS`).
    const next = await manifestHead(db, operatorId, manifestId);
    if (!next) return;

    if (next.nextAttemptAt && Date.parse(next.nextAttemptAt) > Date.now()) {
      // Todavía en backoff — no reintentar antes de tiempo, y no adelantar
      // nada detrás en este manifiesto (FIFO). Un evento `online` posterior,
      // o el propio timer de retroceso más abajo, volverá a intentarlo.
      return;
    }

    if (!isMounted()) return;
    const token = await claimPending(db, next.id!);
    if (!token) {
      // Otro drenador (el evento `online` y el mount disparando juntos al
      // salir de un túnel) ganó la reclamación primero. Reintentar la
      // cabeza de la cola: si sigue "sending" bajo el otro token, listPending
      // ya no la devuelve y el bucle avanza solo.
      continue;
    }

    if (!isMounted()) return;
    let result: OfflineQueueOutcome;
    try {
      result = await send({ ...next, status: 'sending', claimToken: token });
    } catch (err) {
      result = { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
    }
    if (!isMounted()) return;

    if (result.outcome === 'sent') {
      await markSent(db, next.id!, token);
      continue;
    }
    if (result.outcome === 'dead') {
      await markDead(db, next.id!, result.reason, token);
      continue;
    }
    if (result.outcome === 'offline') {
      // Costura 1 — `offline` nunca cuenta contra `MAX_RETRY_ATTEMPTS` ni
      // llega a `dead` por agotarlo. Sigue `pending`, con su reintento
      // contado y el siguiente intento programado con el mismo retroceso
      // exponencial que `transient` — el evento `online` lo reintentará de
      // todas formas mucho antes de que ese backoff venza.
      await markFailed(db, next.id!, result.reason, token, nextBackoffAt(next.retryCount));
      return;
    }
    // M5, ronda 3 de review del PR #679 (mayor) — un 'retry' (transient) que
    // ya agotó `MAX_RETRY_ATTEMPTS` deja de ser "reintentable": se da por
    // muerta en vez de reprogramar otro backoff que nunca la resolvería
    // sola. Sin esto, un `transient` desconocido reintenta cada
    // `MAX_BACKOFF_MS` para siempre y `getPendingPickupCount` lo sigue
    // contando como `pending`.
    if (next.retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
      await markDead(
        db,
        next.id!,
        `retries exhausted after ${MAX_RETRY_ATTEMPTS} attempts: ${result.reason}`,
        token,
      );
      continue;
    }
    // 'retry' (transient) — un 500, un rechazo del servidor que no es de
    // los cuatro sentinelas irrecuperables. No la descarta: la deja
    // `pending` con su reintento contado, el motivo guardado y el siguiente
    // intento programado con retroceso exponencial y techo. Se detiene
    // aquí — el resto del manifiesto espera detrás de ésta, FIFO.
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
  // B1, ronda 3 de review del PR #679 (bloqueante) — un `drain()` en vuelo
  // en el momento del desmontaje puede terminar de reprogramar su reintento
  // DESPUÉS de que el cleanup del efecto ya corrió: `send()` resuelve,
  // `calls`/estado se actualiza, pero `markFailed`/`purgeConfirmed` y la
  // llamada a `scheduleRetry` siguen pendientes cuando el componente se
  // desmonta. Sin este guard, ese `scheduleRetry` tardío empuja un timer
  // nuevo a un `timersRef.current` que ya nadie va a limpiar — huérfano para
  // siempre, el mismo riesgo de custodia que el resto de B1 (un timer que
  // dispara con el `operatorId`/`userId` de una sesión que ya cerró).
  const mountedRef = useRef(true);

  const scheduleRetry = useCallback((delayMs: number, run: () => void) => {
    if (!mountedRef.current) return;
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
    // M-1, ronda 4 de review del PR #679 — no arrancar una pasada nueva si
    // ya nos desmontamos (ver el docstring de `mountedRef` más abajo y el
    // de `drainManifest`).
    if (!mountedRef.current) return;
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
      // drenado. Dentro de cada uno, `drainManifest` puede además procesar
      // la cabeza de FIFO de OTRO usuario una vez reclamable (decisión del
      // usuario, ronda 4 — `manifestIsBlocked`/`CROSS_USER_RECLAIM_MS`);
      // este filtro sólo decide qué manifiestos vale la pena intentar desde
      // esta sesión, no qué entradas se tocan dentro de ellos.
      const pending = ownEntries(await listPending(db, operatorId), userId);
      const manifestIds = Array.from(new Set(pending.map((e) => e.manifestId)));
      // FIFO estricto DENTRO de un manifiesto; entre manifiestos distintos
      // puede ir en paralelo (spec-81, "Orden: FIFO estricto por
      // manifiesto").
      const isMounted = () => mountedRef.current;
      await Promise.all(
        manifestIds.map((id) => drainManifest(operatorId, userId, id, send, isMounted)),
      );

      // `purgeConfirmed` no filtra por usuario — borra `sent` del operador
      // entero. Es sólo limpieza de filas ya confirmadas por el servidor;
      // no hay dato de negocio ni custodia que proteger ahí.
      await purgeConfirmed(db, operatorId);

      // Si algo quedó en backoff, no esperar a un nuevo evento `online` —
      // reprogramar un intento cuando el más próximo esté debido. Sólo
      // sobre las entradas de esta sesión: reprogramar por la de otro
      // usuario no adelantaría nada que `drainManifest` no vaya a intentar
      // ya por su cuenta.
      //
      // Costura 2, ronda 4 de review del PR #679 — antes de esta ronda, este
      // filtro usaba `manifestHasDeadEntry` en solitario, un predicado
      // DISTINTO del que `drainManifest` usa para decidir si un manifiesto
      // puede avanzar (`manifestHasDeadEntry` + `manifestBlockedForUser`).
      // Un manifiesto bloqueado sólo por la segunda guarda (M3) no se
      // excluía aquí: si su `nextAttemptAt` ya había vencido, `soonest`
      // calculaba `delay === 0` en cada pasada — `drain()` se reprogramaba
      // inmediato, repetía el mismo estado bloqueado, y volvía a dar 0. Sin
      // techo, sin salida (medido: ~45 pasadas/s, 0 envíos, hasta
      // desmontar). Usar `manifestIsBlocked` — el MISMO predicado que
      // `drainManifest` — aquí cierra la costura de raíz: las dos guardas ya
      // no pueden divergir porque son una sola función.
      const remainingAll = ownEntries(await listPending(db, operatorId), userId);
      const remainingManifestIds = Array.from(new Set(remainingAll.map((e) => e.manifestId)));
      const blockedManifestIds = new Set(
        (
          await Promise.all(
            remainingManifestIds.map(async (id) => ({
              id,
              blocked: await manifestIsBlocked(db, operatorId, id, userId),
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
      // M-1, ronda 4 de review del PR #679 — sin el guard de `mountedRef`,
      // un `online` (o un reintento programado) que llegaba MIENTRAS
      // `drain()` seguía en vuelo en el momento del desmontaje marcaba
      // `rerunRequestedRef` y este `finally` ejecutaba esa pasada nueva de
      // todas formas — recogiendo incluso entradas encoladas DESPUÉS del
      // desmontaje, con el `send` (JWT) de la sesión que acaba de cerrar.
      // Medido por el reviewer (E3): 2 envíos tras el desmontaje.
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        if (mountedRef.current) void drain();
      }
    }
  }, [operatorId, userId, send, scheduleRetry]);

  useEffect(() => {
    mountedRef.current = true;
    void drain();

    const onOnline = () => void drain();
    window.addEventListener('online', onOnline);

    return () => {
      // B1 — desde aquí, ningún `scheduleRetry` posterior (incluido uno de
      // un `drain()` que ya estaba en vuelo al desmontar) puede empujar un
      // timer nuevo — ver el docstring de `mountedRef`.
      mountedRef.current = false;
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

/**
 * Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679, B-1) —
 * "el operario puede reintentar desde la app". Vive fuera del hook a
 * propósito: el único `useOfflineQueue` montado en producción vive dentro de
 * `AppLayout` (alcance global, mismo que `SyncChip`), y ninguna pantalla
 * tiene una referencia a SU `drainNow` — `AppLayout` no expone el valor de
 * retorno del hook. En vez de enhebrar esa referencia a través del shell
 * (fuera del alcance de esta ronda, y `AppLayout.tsx` está en la lista de
 * "no tocar"), esta función usa el mismo mecanismo que ya dispara una pasada
 * desde cualquier punto de la app: el evento `online` global al que el
 * efecto de montaje del hook ya está suscrito (`window.addEventListener`
 * más arriba). No es un evento de conectividad real, pero es exactamente la
 * señal que ese listener existe para atender — "hay trabajo nuevo que
 * intentar ahora, no esperes al próximo backoff".
 */
export async function retryBlockedManifest(operatorId: string, manifestId: string): Promise<void> {
  await retryDead(db, operatorId, manifestId);
  window.dispatchEvent(new Event('online'));
}
