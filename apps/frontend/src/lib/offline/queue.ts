/**
 * spec-81 fase 1 — Contrato puro de la cola offline de Recogida.
 *
 * Encolar, listar pendientes, marcar enviado, marcar fallido con contador de
 * reintentos, purgar lo confirmado. Sin DOM, sin React — el drenado (worker
 * que consume esta cola contra la red) es spec-81 fase 2.
 *
 * Ver docs/specs/spec-81-recogida-cola-offline.md.
 */
import type {
  PickupQueueEntry,
  PickupQueueOperationType,
  RecogidaOfflineQueueDB,
} from "./db";

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
  db: RecogidaOfflineQueueDB,
  input: EnqueueInput,
): Promise<PickupQueueEntry> {
  const id = await db.queue.add({
    clientOperationId: crypto.randomUUID(),
    operatorId: input.operatorId,
    manifestId: input.manifestId,
    type: input.type,
    payload: input.payload,
    blob: input.blob,
    status: "pending",
    retryCount: 0,
    createdAt: new Date().toISOString(),
  });

  const entry = await db.queue.get(id);
  if (!entry) {
    throw new Error(`recogida offline queue: entry ${id} not found right after insert`);
  }
  return entry;
}

/**
 * Entradas pendientes de un operador, en orden FIFO estricto de inserción.
 * Filtrar por `manifestId` acota a un manifiesto (garantiza que su
 * `close_manifest` nunca salga antes que sus escaneos); dos manifiestos
 * distintos pueden drenarse en paralelo (spec-81 fase 2).
 */
export async function listPending(
  db: RecogidaOfflineQueueDB,
  operatorId: string,
  manifestId?: string,
): Promise<PickupQueueEntry[]> {
  const entries = await db.queue
    .where("operatorId")
    .equals(operatorId)
    .and((entry) => entry.status === "pending")
    .and((entry) => manifestId === undefined || entry.manifestId === manifestId)
    .toArray();

  return entries.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** Marca una entrada como confirmada por el servidor. */
export async function markSent(db: RecogidaOfflineQueueDB, id: number): Promise<void> {
  await db.queue.update(id, { status: "sent" });
}

/**
 * Registra un intento fallido: incrementa `retryCount` y guarda el motivo.
 * La entrada permanece `pending` — sigue siendo candidata a reintento en
 * fase 2 — y conserva su `client_operation_id` original.
 */
export async function markFailed(
  db: RecogidaOfflineQueueDB,
  id: number,
  errorMessage: string,
): Promise<void> {
  const entry = await db.queue.get(id);
  if (!entry) return;

  await db.queue.update(id, {
    retryCount: entry.retryCount + 1,
    lastError: errorMessage,
  });
}

/**
 * Borra las entradas ya confirmadas (`sent`) de un operador. Ver spec-81,
 * "Riesgos" — tope declarado de 500 entradas sin confirmar por operador;
 * `purgeConfirmed` es lo que mantiene la cuota bajo control una vez que
 * fase 2 la invoque tras cada drenado exitoso.
 */
export async function purgeConfirmed(
  db: RecogidaOfflineQueueDB,
  operatorId: string,
): Promise<number> {
  return db.queue
    .where("operatorId")
    .equals(operatorId)
    .and((entry) => entry.status === "sent")
    .delete();
}
