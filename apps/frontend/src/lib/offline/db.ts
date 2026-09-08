/**
 * spec-81 fase 1 — Almacén IndexedDB de la cola offline de Recogida.
 *
 * Distinto del `AureonOfflineDB` de Recepción (`./indexedDB.ts`) a propósito:
 * spec-81 conecta sólo Recogida (ver "Riesgos" en el spec). Adoptarlo en otros
 * módulos es trabajo posterior con sus propios specs.
 *
 * Ver docs/specs/spec-81-recogida-cola-offline.md — "Decisiones de diseño".
 */
import Dexie, { type EntityTable } from "dexie";

/** Operaciones de Recogida que hoy pasan por la cola offline. */
export type PickupQueueOperationType = "pickup_scan" | "close_manifest";

export type PickupQueueEntryStatus = "pending" | "sent";

export interface PickupQueueEntry {
  /** Clave primaria autoincremental de Dexie. También es el orden FIFO de
   * inserción: las entradas se listan ordenadas por este campo, así que un
   * manifiesto nunca ve su `close_manifest` adelantar a los escaneos que
   * produjeron su conteo. */
  id?: number;
  /** UUID v4 generado por el cliente al encolar. Es la clave de idempotencia
   * que el servidor persiste (spec-81 fase 3) y NUNCA se regenera en un
   * reintento — ver spec-79 (`external_route_id`) como precedente de por qué
   * esto tiene que sobrevivir intacto entre reintentos. */
  clientOperationId: string;
  operatorId: string;
  manifestId: string;
  type: PickupQueueOperationType;
  payload: Record<string, unknown>;
  /**
   * Reservado para spec-81 fase 5 (fotos): el blob de la foto capturada.
   * Deliberadamente sin usar en fase 1 — el hueco está para que una entrada
   * de foto quepa en el mismo tipo sin rediseñarlo, no para implementarlo
   * aquí.
   */
  blob?: Blob;
  status: PickupQueueEntryStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
}

export class RecogidaOfflineQueueDB extends Dexie {
  queue!: EntityTable<PickupQueueEntry, "id">;

  constructor() {
    super("AureonRecogidaOfflineQueue");

    this.version(1).stores({
      queue: "++id, clientOperationId, operatorId, manifestId, status, [manifestId+status]",
    });
  }
}

export const recogidaQueueDB = new RecogidaOfflineQueueDB();
