/**
 * IndexedDB Database Definition (Dexie.js)
 * Story 1.5: PWA Enhancement Layer
 *
 * Offline-first storage for pickup scans
 * Task 3.1-3.4: Complete IndexedDB setup
 */

import Dexie, { type EntityTable } from 'dexie';

// Scan Queue Interface (Task 3.1)
export interface ScanQueue {
  id?: number; // Auto-increment primary key
  manifest_id: string; // Indexed for manifest-specific queries
  order_id: string;
  barcode_scanned: string;
  scan_status: 'success' | 'error' | 'duplicate';
  scanned_at: Date;
  synced: boolean; // Indexed for unsync queries
  operator_id: string; // Indexed for tenant isolation
  user_id: string;
  created_at: Date;
  synced_at?: Date | null; // NULL until synced
  error_message?: string | null; // NULL unless error
}

/**
 * spec-81 — cola offline de Recogida (escaneos, cierres de carga, y en fase 5
 * fotos). Vive en esta misma base porque `useSyncQueue`/`SyncChip`/
 * `PickupFlowHeader` YA leen `db.scan_queue` de aquí para el badge "COLA N" —
 * ver ronda 1 de review de spec-81 fase 1 (B1). Una base IndexedDB separada
 * dejaría esos contadores en 0 mientras las entradas de Recogida esperan en
 * otro origen de almacenamiento.
 */
export type PickupQueueOperationType = 'pickup_scan' | 'close_manifest';

/**
 * `pending`: candidata a envío. `sending`: un drenador la reclamó — evita que
 * dos pasadas concurrentes (el mount y el evento `online` disparando juntos
 * al salir de un túnel) la envíen dos veces. `sent`: confirmada por el
 * servidor. `dead`: agotó los reintentos con un rechazo de negocio
 * irrecuperable — sale de `listPending` sin mentir que se envió y sin
 * borrarse en silencio (spec-81 fase 1, ronda 1 de review, B3).
 */
export type PickupQueueEntryStatus = 'pending' | 'sending' | 'sent' | 'dead';

export interface PickupQueueEntry {
  /** Clave primaria autoincremental de Dexie. También es el orden FIFO de
   * inserción: `listPending` ordena por este campo, así que un manifiesto
   * nunca ve su `close_manifest` adelantar a los escaneos que produjeron su
   * conteo. */
  id?: number;
  /** UUID v4 generado por el cliente al encolar. Es la clave de idempotencia
   * que el servidor persiste (spec-81 fase 3) y NUNCA se regenera en un
   * reintento. */
  clientOperationId: string;
  operatorId: string;
  manifestId: string;
  type: PickupQueueOperationType;
  payload: Record<string, unknown>;
  /**
   * Reservado para spec-81 fase 5 (fotos): el blob de la foto capturada.
   * Deliberadamente sin usar en fase 1.
   */
  blob?: Blob;
  status: PickupQueueEntryStatus;
  retryCount: number;
  lastError?: string;
  /** ISO 8601. Cuándo se intentó por última vez — persistido, no en memoria,
   * para que el backoff exponencial de fase 2 sobreviva a que la PWA se
   * cierre y reabra a mitad de reintento (spec-81 fase 1, ronda 1, B3). */
  lastAttemptAt: string | null;
  /** ISO 8601. Cuándo puede volver a intentarse — lo calcula y persiste fase
   * 2 al fallar un intento; fase 1 sólo reserva el campo. */
  nextAttemptAt: string | null;
  createdAt: string;
}

// Dexie Database Class (Task 3.1)
class AureonOfflineDB extends Dexie {
  scan_queue!: EntityTable<ScanQueue, 'id'>;
  pickup_queue!: EntityTable<PickupQueueEntry, 'id'>;

  constructor() {
    super('aureon_offline');

    // Define schema version 1
    this.version(1).stores({
      scan_queue:
        '++id, manifest_id, operator_id, synced, [manifest_id+synced], scanned_at',
    });

    // spec-81 fase 1 — cola offline de Recogida. No se toca el índice de
    // `scan_queue`: los índices se congelan en la versión donde se
    // publicaron (ver spec-81, ronda 1, B7).
    this.version(2).stores({
      pickup_queue: '++id, clientOperationId, operatorId, manifestId, status',
    });
  }
}

// Export database instance (Task 3.2)
export const db = new AureonOfflineDB();

/**
 * Cuántas entradas de la cola de Recogida siguen sin confirmar, en todo el
 * dispositivo. Deliberadamente no filtra por operador — mismo criterio que
 * `getUnsynced()` de abajo, que tampoco lo hace: el badge del topbar es
 * global al dispositivo, no por operador.
 */
export async function getPendingPickupCount(): Promise<number> {
  return db.pickup_queue.where('status').equals('pending').count();
}

/**
 * Pide al navegador que el origen sea "persistent" en vez de "best-effort".
 * Sin esto, iOS Safari (no instalado) purga IndexedDB a los 7 días sin
 * interacción y Android puede desalojar el origen entero bajo presión de
 * disco — ver spec-81, ronda 1 de review, M4. `5d` promete "GUARDADO EN EL
 * DISPOSITIVO"; sin este permiso esa frase no es verdad.
 *
 * Devuelve `false` (nunca lanza) cuando la API no existe — mismo patrón
 * defensivo que `checkStorageQuota`.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  return navigator.storage.persist();
}

// Helper Functions (Task 3.3)

/**
 * Get all unsynced scans
 */
export async function getUnsynced(): Promise<ScanQueue[]> {
  return await db.scan_queue.filter((scan) => !scan.synced).toArray();
}

/**
 * Get unsynced scans for a specific manifest
 */
export async function getUnsyncedByManifest(
  manifestId: string
): Promise<ScanQueue[]> {
  return await db.scan_queue
    .where('manifest_id')
    .equals(manifestId)
    .filter((scan) => !scan.synced)
    .toArray();
}

/**
 * Mark scans as synced (bulk update)
 */
export async function markSynced(ids: number[]): Promise<void> {
  const now = new Date();
  await db.scan_queue.bulkUpdate(
    ids.map((id) => ({
      key: id,
      changes: {
        synced: true,
        synced_at: now,
      },
    }))
  );
}

/**
 * Clear old synced scans (older than X days)
 */
export async function clearOldSynced(days = 7): Promise<number> {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return await db.scan_queue
    .filter((scan) => scan.synced && scan.synced_at !== null && scan.synced_at! < cutoffDate)
    .delete();
}

// Quota Management (Task 3.4)

/**
 * Check IndexedDB storage quota
 * Returns percentage used (0-100)
 */
export async function checkStorageQuota(): Promise<{
  percentUsed: number;
  warning: 'none' | 'high' | 'critical' | 'full';
}> {
  if (navigator.storage?.estimate) {
    const quota = await navigator.storage.estimate();
    const usage = quota.usage || 0;
    const limit = quota.quota || 0;
    const percentUsed = limit > 0 ? (usage / limit) * 100 : 0;

    let warning: 'none' | 'high' | 'critical' | 'full' = 'none';

    if (percentUsed > 95) {
      warning = 'full';
      // Aggressive cleanup: synced scans older than 1 day
      await clearOldSynced(1);
      console.warn(`[IndexedDB] Storage >95% (${percentUsed.toFixed(1)}%). Critical cleanup performed.`);
    } else if (percentUsed > 90) {
      warning = 'critical';
      // Cleanup synced scans older than 3 days
      await clearOldSynced(3);
      console.warn(`[IndexedDB] Storage >90% (${percentUsed.toFixed(1)}%). Cleaned up synced scans >3 days.`);
    } else if (percentUsed > 80) {
      warning = 'high';
      // Cleanup synced scans older than 7 days
      const deletedCount = await clearOldSynced(7);
      console.log(`[IndexedDB] Storage >80% (${percentUsed.toFixed(1)}%). Cleaned up ${deletedCount} old scans.`);
    }

    return { percentUsed, warning };
  }

  return { percentUsed: 0, warning: 'none' };
}

/**
 * Get storage usage info (for UI display)
 */
export async function getStorageInfo(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
}> {
  if (navigator.storage?.estimate) {
    const quota = await navigator.storage.estimate();
    const usage = quota.usage || 0;
    const limit = quota.quota || 0;
    const percentUsed = (usage / limit) * 100;

    return {
      usage,
      quota: limit,
      percentUsed,
    };
  }

  return {
    usage: 0,
    quota: 0,
    percentUsed: 0,
  };
}
