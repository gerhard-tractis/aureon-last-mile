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
 *
 * Fase 2 — reclamar/confirmar/reintentar/matar (`claimPending`, `markSent`,
 * `markFailed`, `markDead`, `reclaimStale`) viven en `./queue-claims`, sólo
 * por tamaño de archivo (regla de 300 líneas). Re-exportados aquí para que
 * ningún llamador tenga que saber que el módulo está partido en dos.
 */
import type { PickupQueueEntry, PickupQueueOperationType } from "../db";
import type { PickupQueueStore } from "./queue-claims";

export type { PickupQueueStore } from "./queue-claims";
export {
  claimPending,
  markDead,
  markFailed,
  markSent,
  reclaimStale,
} from "./queue-claims";

export interface EnqueueInput {
  operatorId: string;
  /** B4, ronda 2 de review del PR #679 — ver el docstring de `userId` en
   * `PickupQueueEntry` (`@/lib/db`). Requerido: sin él, el drenador no
   * tiene forma de saber que esta entrada es suya. */
  userId: string;
  manifestId: string;
  type: PickupQueueOperationType;
  payload: Record<string, unknown>;
  /** Ver PickupQueueEntry.blob — reservado, sin lógica hasta fase 5. */
  blob?: Blob;
}

/**
 * m3, ronda 1 de review del PR #679 — "Riesgos" declara este tope vigente
 * desde fase 2: encolar por encima de 500 entradas sin confirmar
 * (`status !== "sent"`) por operador debe rechazarse con un error explícito
 * en vez de fallar en silencio contra la cuota real de IndexedDB del
 * navegador. `sent` no cuenta porque `purgeConfirmed` las borra tras cada
 * drenado exitoso — son transitorias, no acumulación real.
 */
const MAX_UNCONFIRMED_ENTRIES_PER_OPERATOR = 500;

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
  const unconfirmedCount = await db.pickup_queue
    .where("operatorId")
    .equals(input.operatorId)
    .and((entry) => entry.status !== "sent")
    .count();
  if (unconfirmedCount >= MAX_UNCONFIRMED_ENTRIES_PER_OPERATOR) {
    throw new Error(
      `recogida offline queue: cola llena (${MAX_UNCONFIRMED_ENTRIES_PER_OPERATOR} entradas sin confirmar) para este operador — no se puede encolar más hasta que el drenado confirme o descarte alguna`,
    );
  }

  const id = await db.pickup_queue.add({
    clientOperationId: crypto.randomUUID(),
    operatorId: input.operatorId,
    userId: input.userId,
    manifestId: input.manifestId,
    type: input.type,
    payload: input.payload,
    blob: input.blob,
    status: "pending",
    retryCount: 0,
    claimToken: null,
    lastAttemptAt: null,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
  });
  if (id === undefined) {
    throw new Error("recogida offline queue: add() did not return an id");
  }

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
 * B3, ronda 1 de review del PR #679 — `listPending` excluye `dead` (a
 * propósito, ver su docstring), lo que significa que un escaneo muerto
 * simplemente desaparece de la cola: sin este check, el `close_manifest`
 * que iba detrás en el FIFO pasa a la cabeza en la pasada siguiente y
 * cierra el manifiesto con un bulto menos del que el operario contó — el
 * riesgo nº1 que el spec declara.
 *
 * Por qué basta con "¿hay ALGÚN `dead` en este manifiesto?" en vez de
 * comparar ids: para que una entrada llegue a `dead`, tuvo que ser la
 * cabeza del FIFO en su momento — así que todo lo que tenía un id menor ya
 * se resolvió (`sent`) en una pasada anterior. Ninguna entrada con id menor
 * puede seguir `pending` cuando existe una `dead` en el mismo manifiesto,
 * así que "algún `dead`" y "hay un `dead` por delante de esta entrada" son
 * equivalentes aquí.
 *
 * Deliberadamente permanente: nada en este módulo vuelve a poner en marcha
 * un manifiesto envenenado — eso es una decisión de negocio (resolver la
 * discrepancia), no algo que este drenador deba automatizar.
 */
export async function manifestHasDeadEntry(
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
): Promise<boolean> {
  const count = await db.pickup_queue
    .where("operatorId")
    .equals(operatorId)
    .and((entry) => entry.manifestId === manifestId && entry.status === "dead")
    .count();
  return count > 0;
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
