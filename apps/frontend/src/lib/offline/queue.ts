/**
 * spec-81 fase 1 — Contrato puro de la cola offline de Recogida.
 *
 * Encolar, listar pendientes, reclamar para envío, marcar enviado, marcar
 * fallido con contador de reintentos, marcar muerta (rechazo irrecuperable),
 * purgar lo confirmado. Sin DOM, sin React — el drenado (worker que consume
 * esta cola contra la red) es spec-81 fase 2.
 *
 * Ronda 1 de review: opera sobre `AureonOfflineDB` (`@/lib/db`), la base que
 * ya usan `useSyncQueue`/`SyncChip`/`PickupFlowHeader` — no una base propia
 * (B1). Ver docs/specs/spec-81-recogida-cola-offline.md.
 */
import type { PickupQueueEntry, PickupQueueOperationType } from "../db";

/** Una colección Dexie ya acotada por `.where().equals()` — soporta filtrar
 * más (`.and()`), escribir atómicamente dentro de una única transacción
 * (`.modify()`) o borrar (`.delete()`), en cualquier orden. */
interface PickupQueueCollection {
  and(filter: (entry: PickupQueueEntry) => boolean): PickupQueueCollection;
  modify(
    changes: Partial<PickupQueueEntry> | ((entry: PickupQueueEntry) => void),
  ): Promise<number>;
  delete(): Promise<number>;
  toArray(): Promise<PickupQueueEntry[]>;
}

/** El subconjunto de `AureonOfflineDB` que este módulo necesita — permite
 * pasar la instancia real (`db` de `@/lib/db`) o un doble de prueba. */
export interface PickupQueueStore {
  pickup_queue: {
    add(entry: PickupQueueEntry): Promise<number>;
    get(id: number): Promise<PickupQueueEntry | undefined>;
    where(index: string): {
      equals(value: unknown): PickupQueueCollection;
    };
  };
}

export interface EnqueueInput {
  operatorId: string;
  manifestId: string;
  type: PickupQueueOperationType;
  payload: Record<string, unknown>;
  /** Ver PickupQueueEntry.blob — reservado, sin lógica hasta fase 5. */
  blob?: Blob;
}

/**
 * Encola una operación. Genera el `client_operation_id` (UUID v4) una única
 * vez, aquí. Ninguna otra función de este módulo lo toca — un reintento
 * (`markFailed` seguido de un nuevo intento de envío en fase 2) reutiliza
 * siempre la misma entrada y el mismo id.
 */
export async function enqueue(
  db: PickupQueueStore,
  input: EnqueueInput,
): Promise<PickupQueueEntry> {
  const id = await db.pickup_queue.add({
    clientOperationId: crypto.randomUUID(),
    operatorId: input.operatorId,
    manifestId: input.manifestId,
    type: input.type,
    payload: input.payload,
    blob: input.blob,
    status: "pending",
    retryCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
  });

  const entry = await db.pickup_queue.get(id);
  if (!entry) {
    throw new Error(`recogida offline queue: entry ${id} not found right after insert`);
  }
  return entry;
}

/**
 * Entradas pendientes de un operador, en orden FIFO estricto de inserción.
 * `.where("operatorId").equals(operatorId)` ya entrega ese orden gratis: un
 * cursor de IndexedDB sobre un único valor de un índice no único viene
 * desempatado por clave primaria ascendente (la misma garantía que hacía
 * redundante el `.sort()` que se quitó en B6) — así que no hace falta un
 * `orderBy` explícito.
 *
 * Usa el índice `operatorId` en vez de recorrer toda la tabla: un table scan
 * deserializa también las entradas de otros operadores, las `sent` sin
 * purgar y, desde fase 5, el `Blob` de cada fila, sólo para descartar la
 * mayoría (spec-81, ronda 3 de review, H5).
 *
 * Excluye `sending` (reclamada por otro drenado en curso) y `dead`
 * (rechazo irrecuperable) además de `sent`.
 */
export async function listPending(
  db: PickupQueueStore,
  operatorId: string,
  manifestId?: string,
): Promise<PickupQueueEntry[]> {
  return db.pickup_queue
    .where("operatorId")
    .equals(operatorId)
    .and(
      (entry) =>
        entry.status === "pending" &&
        (manifestId === undefined || entry.manifestId === manifestId),
    )
    .toArray();
}

/**
 * Marca una entrada como confirmada por el servidor.
 *
 * `claimedAt`, opcional (M1, ronda 4 de review) — el token de propiedad que
 * `claimPending` devolvió cuando esta llamada reclamó la entrada. Si se pasa
 * y ya no coincide con el `lastAttemptAt` actual de la entrada, la llamada es
 * un no-op completo: significa que otro drenador la reclamó de nuevo
 * mientras esta seguía en vuelo (p. ej. tras un `reclaimStale` que la dio por
 * huérfana), y un 200 tardío del primero no puede confirmar el envío del
 * segundo, que sigue en curso. Sin `claimedAt` se comporta como antes —
 * necesario porque `claimPending` no es la única vía de `pending` a
 * `sending` para código que aún no rastrea el token.
 */
export async function markSent(
  db: PickupQueueStore,
  id: number,
  claimedAt?: string,
): Promise<void> {
  await db.pickup_queue
    .where(":id")
    .equals(id)
    .and((entry) => claimedAt === undefined || entry.lastAttemptAt === claimedAt)
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
 * Devuelve el `lastAttemptAt` (ISO 8601) que acaba de estampar si esta
 * llamada ganó la reclamación, `null` si la entrada ya no estaba `pending`
 * (otro drenado se le adelantó, o no existe). Ese valor devuelto ES el token
 * de propiedad de la reclamación — el único dato que distingue "mi
 * reclamación" de "la de otro drenador" cuando dos pasan por el mismo `id`
 * (M1, ronda 4 de review: antes devolvía sólo un `boolean`, así que
 * `markFailed`/`markSent` no podían hacer esa distinción y un zombi podía
 * resolver la reclamación de otro).
 */
export async function claimPending(db: PickupQueueStore, id: number): Promise<string | null> {
  const now = new Date().toISOString();
  const count = await db.pickup_queue
    .where(":id")
    .equals(id)
    .and((entry) => entry.status === "pending")
    .modify((entry) => {
      entry.status = "sending";
      entry.lastAttemptAt = now;
    });
  return count === 1 ? now : null;
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
 * `markSent`: si se pasa y ya no coincide con el `lastAttemptAt` actual, la
 * llamada entera es un no-op (ni incrementa `retryCount` ni toca `status`).
 * Sin esto, el fallo tardío de un drenador zombi cuya reclamación ya expiró
 * y fue reasignada por `reclaimStale` liberaba la reclamación **del segundo
 * drenador**, con su envío real todavía en vuelo — `claimPending` vuelve a
 * devolver esa entrada como disponible y produce un tercer envío.
 */
export async function markFailed(
  db: PickupQueueStore,
  id: number,
  errorMessage: string,
  claimedAt?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.pickup_queue
    .where(":id")
    .equals(id)
    .and((entry) => claimedAt === undefined || entry.lastAttemptAt === claimedAt)
    .modify((entry) => {
      entry.retryCount += 1;
      entry.lastError = errorMessage;
      entry.lastAttemptAt = now;
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
 * la excepción que sí se justifica para un contador. `listPending` y
 * `purgeConfirmed` ya lo llevaban; sin llamador todavía hoy, así que añadir
 * el parámetro no rompe nada — el momento estrictamente más barato para
 * hacerlo es ahora, antes de que fase 2 lo invoque sin él.
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
    .modify({ status: "pending" });
}

/**
 * Marca una entrada como muerta: un rechazo de negocio irrecuperable (p. ej.
 * `MANIFEST_NOT_CLOSABLE`) que reintentar nunca va a arreglar. Sale de
 * `listPending` sin mentir que se envió (`sent`) y sin desaparecer en
 * silencio (borrarla sería el riesgo nº1 del spec: una carga que se cierra
 * con un conteo falso). Ver spec-81, ronda 1 de review, B3.
 */
export async function markDead(
  db: PickupQueueStore,
  id: number,
  reason: string,
): Promise<void> {
  await db.pickup_queue
    .where(":id")
    .equals(id)
    .modify({ status: "dead", lastError: reason });
}

/**
 * Borra las entradas ya confirmadas (`sent`) de un operador. Ver spec-81,
 * "Riesgos" — tope declarado de 500 entradas sin confirmar por operador;
 * `purgeConfirmed` es lo que mantiene la cuota bajo control una vez que
 * fase 2 la invoque tras cada drenado exitoso.
 */
export async function purgeConfirmed(
  db: PickupQueueStore,
  operatorId: string,
): Promise<number> {
  return db.pickup_queue
    .where("operatorId")
    .equals(operatorId)
    .and((entry) => entry.status === "sent")
    .delete();
}
