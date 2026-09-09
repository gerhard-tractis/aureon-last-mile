/**
 * spec-81 — la parte de la cola offline de Recogida que reclama, confirma,
 * reintenta y da por muerta una entrada. Separado de `queue.ts` (encolar,
 * listar, purgar) sólo por tamaño de archivo — es el mismo contrato, la
 * misma tabla (`pickup_queue`), y `queue.ts` re-exporta todo esto: ningún
 * llamador necesita saber que el módulo está partido en dos ficheros.
 *
 * Ver docs/specs/spec-81-recogida-cola-offline.md.
 */
import type { AureonOfflineDB, PickupQueueEntry } from "../db";

/**
 * `AureonOfflineDB` en vez de una interfaz estructural propia (fase 2) — el
 * tipo real de Dexie para `pickup_queue`. `import type`, sin importar el
 * singleton `db`: este módulo sigue sin tocar IndexedDB en tiempo de import,
 * sólo su tipo. Antes de fase 2 esto era una interfaz hecha a mano
 * (`PickupQueueCollection`/`PickupQueueStore`) que nada usaba salvo la
 * instancia real — y que resultó ser estructuralmente incompatible con el
 * `Table.modify()` real de Dexie (está sobrecargado: forma de objeto de
 * cambios y forma de callback con un segundo argumento `ctx`), algo que
 * `tsc` nunca comprobó porque excluye `*.test.ts` y nada de producción
 * llamaba a estas funciones hasta `useOfflineQueue` (primer llamador real).
 */
export type PickupQueueStore = AureonOfflineDB;

/**
 * Contrato unificado de reclamación para los tres escritores terminales
 * (`markSent`, `markFailed`, `markDead`) — spec-81, checklist de fase 2:
 * "los tres escritores terminales no tienen el mismo contrato aunque sus
 * docstrings lo afirman".
 *
 * Sin `claimedAt`: no exige ninguna reclamación — es la vía sin rastrear,
 * para código que aún no lleva token. Con `claimedAt`: exige que la entrada
 * siga `sending` bajo ESE token exacto — ambas condiciones, no sólo el
 * token. La comparación de sólo-token ya fue insuficiente una vez (M1): un
 * token que sobrevive a un `reclaimStale` sin invalidarse podría, en teoría,
 * volver a coincidir con una reclamación futura; exigir también el estado
 * cierra esa vía incluso si `reclaimStale` alguna vez dejara de limpiar
 * `claimToken`.
 */
function matchesClaim(entry: PickupQueueEntry, claimedAt: string | undefined): boolean {
  return claimedAt === undefined || (entry.status === "sending" && entry.claimToken === claimedAt);
}

/**
 * Marca una entrada como confirmada por el servidor.
 *
 * `claimedAt`, opcional (M1, ronda 4 de review) — el token de propiedad que
 * `claimPending` devolvió cuando esta llamada reclamó la entrada. Si se pasa
 * y ya no coincide con el token actual de la entrada, la llamada es un
 * no-op completo: significa que otro drenador la reclamó de nuevo mientras
 * esta seguía en vuelo (p. ej. tras un `reclaimStale` que la dio por
 * huérfana), y un 200 tardío del primero no puede confirmar el envío del
 * segundo, que sigue en curso. Sin `claimedAt` se comporta como antes —
 * necesario porque `claimPending` no es la única vía de `pending` a
 * `sending` para código que aún no rastrea el token.
 *
 * También es un no-op si la entrada ya está `dead` (m5, ronda 5 de review) —
 * un 200 tardío no puede reabrir algo que ya se decidió irrecuperable, la
 * misma asimetría que H3 cierra del lado de `markFailed`.
 *
 * Devuelve el `count` real de `.modify()` (0 ó 1) — no `void` (m4, ronda 5 de
 * review). Sin esto un drenador que encadene `markSent` con `purgeConfirmed`
 * no puede saber si su 200 se registró de verdad antes de purgar.
 */
export async function markSent(
  db: PickupQueueStore,
  id: number,
  claimedAt?: string,
): Promise<number> {
  return db.pickup_queue
    .where(":id")
    .equals(id)
    .and((entry) => matchesClaim(entry, claimedAt) && entry.status !== "dead")
    .modify({ status: "sent" });
}

/**
 * Reclama una entrada `pending` para enviarla, marcándola `sending`. Atómico:
 * usa `.modify()` con un filtro `status === "pending"` para que dos pasadas
 * de drenado concurrentes (el evento `online` y el montaje disparando juntos
 * al salir de un túnel) no puedan enviar la misma entrada dos veces —
 * `.modify()` corre en una única transacción a nivel del motor de IndexedDB,
 * así que sólo una de las dos llamadas concurrentes ve `count === 1`
 * (spec-81, ronda 1 de review, B3).
 *
 * Devuelve el token de propiedad de la reclamación (`crypto.randomUUID()`,
 * fase 2) si esta llamada ganó, `null` si la entrada ya no estaba `pending`
 * (otro drenado se le adelantó, o no existe). Antes de fase 2 el token era
 * el propio `lastAttemptAt` (una marca de milisegundo): dos reclamaciones
 * sucesivas de la misma entrada dentro del mismo milisegundo — el caso
 * común sin señal, donde `fetch` rechaza casi al instante — producían el
 * mismo valor y el guard de `markFailed`/`markSent`/`markDead` volvía a
 * pasar. `lastAttemptAt` se sigue estampando por separado: mide antigüedad
 * para `reclaimStale`, un problema distinto del de identidad de la
 * reclamación.
 */
export async function claimPending(db: PickupQueueStore, id: number): Promise<string | null> {
  const now = new Date().toISOString();
  const token = crypto.randomUUID();
  const count = await db.pickup_queue
    .where(":id")
    .equals(id)
    .and((entry) => entry.status === "pending")
    .modify((entry) => {
      entry.status = "sending";
      entry.lastAttemptAt = now;
      entry.claimToken = token;
    });
  return count === 1 ? token : null;
}

/**
 * Registra un intento fallido: incrementa `retryCount`, guarda el motivo y
 * el momento del intento, y libera la reclamación (`sending` → `pending`) si
 * la había — sigue siendo candidata a reintento en fase 2. Conserva su
 * `client_operation_id` original.
 *
 * Atómico por construcción: `.modify()` con una función de cambios lee y
 * escribe dentro de la misma transacción, así que dos `markFailed`
 * concurrentes sobre la misma entrada nunca pierden un incremento — a
 * diferencia de la versión anterior (`get` + `update` en dos transacciones
 * separadas), que sí lo perdía (spec-81, ronda 1 de review, B2).
 *
 * `claimedAt`, opcional (M1, ronda 4 de review) — mismo contrato que en
 * `markSent`: si se pasa, es de un solo uso (m3, ronda 5 de review): sólo
 * hace efecto mientras la entrada sigue `sending` bajo ese mismo token. Un
 * replay de la misma respuesta de red con el mismo token (frecuente — sin
 * señal, `fetch` rechaza casi al instante, así que claim y fallo caen en el
 * mismo ms) encuentra la entrada ya devuelta a `pending` por el primer
 * intento y no incrementa `retryCount` de nuevo. Sin esto, el fallo tardío
 * de un drenador zombi cuya reclamación ya expiró y fue reasignada por
 * `reclaimStale` liberaba la reclamación **del segundo drenador**, con su
 * envío real todavía en vuelo — `claimPending` vuelve a devolver esa entrada
 * como disponible y produce un tercer envío.
 *
 * `nextAttemptAt`, opcional (fase 2) — cuándo puede reintentarse (ISO 8601),
 * calculado por el drenador con retroceso exponencial y techo. Persistido
 * (no en memoria) para que el backoff sobreviva a que la PWA se cierre a
 * mitad de reintento — ver `nextAttemptAt` en `PickupQueueEntry`.
 * `undefined` deja el campo intacto; no hay forma de volver a limpiarlo a
 * `null` por este camino, a propósito — nada en este módulo necesita
 * hacerlo hoy.
 */
export async function markFailed(
  db: PickupQueueStore,
  id: number,
  errorMessage: string,
  claimedAt?: string,
  nextAttemptAt?: string,
): Promise<number> {
  const now = new Date().toISOString();
  return db.pickup_queue
    .where(":id")
    .equals(id)
    .and(
      (entry) =>
        matchesClaim(entry, claimedAt) &&
        // Fase 2 — sin token, el guard antiguo era incondicionalmente
        // verdadero: un `markFailed` sin token pisaba `lastError` y
        // `retryCount` de una entrada ya `sent` o `dead`, borrando el único
        // registro de por qué se descartó un escaneo. `matchesClaim` ya
        // exige `sending` cuando SÍ hay token; esto cierra el hueco cuando
        // no lo hay.
        entry.status !== "sent" &&
        entry.status !== "dead",
    )
    .modify((entry) => {
      entry.retryCount += 1;
      entry.lastError = errorMessage;
      entry.lastAttemptAt = now;
      if (nextAttemptAt !== undefined) {
        entry.nextAttemptAt = nextAttemptAt;
      }
      // H3 (ronda 3 de review): sólo libera una reclamación en curso
      // (`sending` → `pending`). Un `sent` o un `dead` son terminales — un
      // 200 tardío llegando después de un timeout local, o un reintento
      // perdido que llega tras el rechazo de negocio, no puede resucitarlos.
      // Resucitar un `sent` sería un duplicado en `pickup_scans` (para eso
      // existe `clientOperationId`); resucitar un `dead` reabriría algo que
      // ya se decidió irrecuperable.
      if (entry.status === "sending") {
        entry.status = "pending";
      }
    });
}

/**
 * Devuelve a `pending` toda entrada `sending` **del operador dado** cuyo
 * `lastAttemptAt` supere `olderThanMs`. Sin esto, `sending` es un estado sin
 * salida: si la pestaña muere justo después de `claimPending` (la PWA
 * cerrada en segundo plano en un muelle con la pantalla apagada), nadie
 * vuelve a tener el `id` de esa entrada — no aparece en `listPending` ni en
 * `getPendingPickupCount`, pero el escaneo sigue sin enviar en
 * `pickup_queue`. `reclaimStale` es lo que un drenador de fase 2 corre al
 * arrancar (mount, evento `online`) para recuperar reclamaciones huérfanas.
 * Ver spec-81, ronda 3 de review, H1.
 *
 * `operatorId` (M2, ronda 4 de review) — esto ES una escritura, a diferencia
 * de un badge de sólo lectura; el no-negociable de `operator_id` no admite
 * la excepción que sí se justifica para un contador.
 *
 * Llamador (fase 2): `olderThanMs` **debe** superar `timeout_http` de la
 * petición de red que hace el drenado. Si no, una petición lenta pero
 * legítima en 2G se reclama como huérfana antes de completarse, entra en un
 * bucle reclaim → resend → resend, y produce el mismo envío duplicado que
 * M1 corrige del lado de `markFailed`/`markSent`.
 */
export async function reclaimStale(
  db: PickupQueueStore,
  operatorId: string,
  olderThanMs: number,
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return db.pickup_queue
    .where("operatorId")
    .equals(operatorId)
    .and(
      (entry) =>
        entry.status === "sending" &&
        // `lastAttemptAt` es no-nulo siempre que el estado sea `sending`:
        // `claimPending` es la única función que produce esa transición y
        // siempre lo estampa en la misma escritura atómica. No hay otro
        // camino a `sending` en este módulo.
        Date.parse(entry.lastAttemptAt as string) <= cutoff,
    )
    // `claimToken: null` (fase 2) — sin esto el token del drenador zombi
    // seguía coincidiendo con lo que hay persistido. `matchesClaim` ya exige
    // `status === "sending"` además del token, así que este `null` es una
    // segunda barrera (defensa en profundidad), no la única — pero es la
    // que el checklist de fase 2 pide explícitamente.
    .modify({ status: "pending", claimToken: null });
}

/**
 * Marca una entrada como muerta: un rechazo de negocio irrecuperable (p. ej.
 * `MANIFEST_NOT_CLOSABLE`) que reintentar nunca va a arreglar. Sale de
 * `listPending` sin mentir que se envió (`sent`) y sin desaparecer en
 * silencio (borrarla sería el riesgo nº1 del spec: una carga que se cierra
 * con un conteo falso). Ver spec-81, ronda 1 de review, B3.
 *
 * `claimedAt`, opcional (B1, ronda 5 de review) — mismo contrato que
 * `markSent`/`markFailed`: `markDead` era el único de los tres escritores
 * terminales sin guard de token. Sin él, el 422 tardío de un drenador zombi
 * (reclamación ya expirada y reasignada por `reclaimStale`) podía marcar
 * `dead` la reclamación **en curso** de un segundo drenador, perdiendo un
 * escaneo que sí estaba en vuelo — exactamente la clase de bug que M1 existe
 * para cerrar, dejada abierta en el tercer escritor.
 *
 * También es un no-op si la entrada ya está `sent` (m5, ronda 5 de review) —
 * un rechazo tardío no puede convertir un envío ya confirmado en un fallo
 * permanente; la asimetría inversa de lo anterior.
 */
export async function markDead(
  db: PickupQueueStore,
  id: number,
  reason: string,
  claimedAt?: string,
): Promise<number> {
  return db.pickup_queue
    .where(":id")
    .equals(id)
    .and((entry) => matchesClaim(entry, claimedAt) && entry.status !== "sent")
    .modify({ status: "dead", lastError: reason });
}

/**
 * Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679, B-1) —
 * "el operario puede reintentar desde la app". Devuelve a `pending`, con el
 * contador de reintentos a 0, toda entrada `dead` de UN manifiesto — nunca
 * de todo el operador, para no reabrir el bloqueo de un manifiesto distinto
 * que el operario no tiene delante. Es la afordancia mínima que convierte
 * "muerto" en "atascado": sin ella, `MAX_RETRY_ATTEMPTS` (`useOfflineQueue.ts`)
 * es un callejón sin salida más, no un techo defendible.
 *
 * `nextAttemptAt`/`claimToken` se limpian a `null` — sin backoff pendiente
 * de antes de morir, listo para que el próximo `drain()` la recoja de
 * inmediato en vez de esperar un retroceso calculado contra un fallo que ya
 * se está reintentando a propósito.
 */
export async function retryDead(
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
): Promise<number> {
  return db.pickup_queue
    .where("operatorId")
    .equals(operatorId)
    .and((entry) => entry.manifestId === manifestId && entry.status === "dead")
    .modify({ status: "pending", retryCount: 0, nextAttemptAt: null, claimToken: null });
}
