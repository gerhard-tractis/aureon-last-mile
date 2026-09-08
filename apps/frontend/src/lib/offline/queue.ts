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
