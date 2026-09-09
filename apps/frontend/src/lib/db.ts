/**
 * IndexedDB Database Definition (Dexie.js)
 * Story 1.5: PWA Enhancement Layer
 *
 * Offline-first storage for pickup scans
 * Task 3.1-3.4: Complete IndexedDB setup
 */

import Dexie, { type EntityTable } from 'dexie';
import { manifestIsBlocked } from './offline/queue-blocking';

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
export type PickupQueueOperationType = 'pickup_scan' | 'close_manifest' | 'manifest_photo';

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
  /**
   * B4, ronda 2 de review del PR #679 (bloqueante) — `auth.users.id` de
   * quien encoló esta entrada, no sólo el inquilino (`operatorId`). Un
   * teléfono de muelle compartido puede tener dos conductores DE LA MISMA
   * empresa (mismo `operatorId`) en sesiones sucesivas — sin esto, el
   * drenador de la sesión de B enviaba la firma que A capturó, y
   * `close_manifest` deriva `signature_operator_name` de `auth.uid()` en el
   * servidor: el cierre quedaba firmado con el nombre de B sobre la firma
   * dibujada de A. `useOfflineQueue` filtra por este campo antes de
   * reclamar cualquier entrada — nunca toca una que esta sesión no encoló.
   */
  userId: string;
  manifestId: string;
  type: PickupQueueOperationType;
  payload: Record<string, unknown>;
  /**
   * spec-81 fase 5: el blob de la foto capturada, para entradas
   * `type: 'manifest_photo'` — ver `lib/offline/photos.ts`. `undefined` para
   * cualquier otro tipo de entrada.
   */
  blob?: Blob;
  status: PickupQueueEntryStatus;
  retryCount: number;
  lastError?: string;
  /**
   * Token de propiedad de la reclamación en curso — `crypto.randomUUID()`,
   * generado por `claimPending` en cada reclamación y comparado por
   * `markSent`/`markFailed`/`markDead` antes de tocar una entrada. Antes de
   * fase 2 esto era el propio `lastAttemptAt` (una marca de milisegundo):
   * dos reclamaciones sucesivas de la misma entrada dentro del mismo
   * milisegundo (el caso común sin señal, donde `fetch` rechaza casi al
   * instante) producían el mismo token y el guard volvía a pasar. Ver
   * spec-81, checklist de fase 2, residual "el token es una marca de
   * milisegundo, no un nonce".
   */
  claimToken: string | null;
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
// Exported as a type-only surface (spec-81 fase 2) so `lib/offline/queue.ts`
// can type its `db` parameter against the real Dexie shape (`import type`,
// no runtime import) instead of a hand-rolled structural interface. Dexie's
// `Table.modify()` is overloaded (a change-object form and a callback form,
// the latter also passing a `ctx` second argument) — TypeScript does not
// treat an overloaded method as assignable to a single union-parameter
// signature, even when every real call site is compatible. `tsc` never
// caught this because it excludes `*.test.ts`, and nothing outside tests
// called these functions with the real `db` until `useOfflineQueue` (fase
// 2, first production caller).
/**
 * spec-82 fase 2 — caché de LECTURA offline por manifiesto ("DESCARGAR" de
 * `5c`). Hermana de `pickup_queue` pero de naturaleza distinta: `pickup_queue`
 * es trabajo por ENVIAR (con `status`/reintentos); esto es una fotografía ya
 * RECIBIDA, sin reintento — se re-descarga a mano, nunca sola. Ver "Por qué
 * una tabla nueva" en docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md,
 * fase 2.
 *
 * Un registro por `(operatorId, externalLoadId)` — nunca dos: `saveManifestSnapshot`
 * (`lib/offline/manifest-cache.ts`) sobrescribe la fila existente en vez de
 * agregar una segunda, para que una re-descarga no deje una copia vieja
 * compitiendo con la nueva.
 */
export interface CachedManifestOrder {
  id: string;
  order_number: string;
  customer_name: string;
  comuna: string;
  delivery_address: string;
  packages: Array<{
    id: string;
    label: string;
    package_number: string | null;
    sku_items: Array<{ sku: string; description: string; quantity: number }>;
    declared_weight_kg: number | null;
  }>;
}

export interface CachedManifestRow {
  id?: number;
  operatorId: string;
  externalLoadId: string;
  manifestId: string;
  totalPackages: number | null;
  pickupRouteId: string | null;
  retailerName: string | null;
  pickupLocation: string | null;
  orders: CachedManifestOrder[];
  /** ISO 8601 — cuándo se tomó esta fotografía. Sin invalidación automática
   * (ver el spec): una fila vieja sigue sirviendo hasta que alguien vuelva a
   * tocar "DESCARGAR" con señal. */
  downloadedAt: string;
}

export class AureonOfflineDB extends Dexie {
  scan_queue!: EntityTable<ScanQueue, 'id'>;
  pickup_queue!: EntityTable<PickupQueueEntry, 'id'>;
  manifest_cache!: EntityTable<CachedManifestRow, 'id'>;

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

    // spec-82 fase 2 — caché de lectura offline por manifiesto. Igual
    // congelamiento de índices que arriba: si una fase futura necesita otro
    // índice, va en una versión nueva, no editando ésta.
    this.version(3).stores({
      manifest_cache:
        '++id, operatorId, externalLoadId, [operatorId+externalLoadId]',
    });
  }
}

// Export database instance (Task 3.2)
export const db = new AureonOfflineDB();

/**
 * Cuántas entradas de la cola de Recogida de un operador siguen en curso,
 * como reintentable: `pending` y `sending` (reclamada, en vuelo).
 *
 * spec-81 fase 2 — pasó de device-global a por operador. Device-global
 * dejaba huérfano el contador de un operador que cerraba sesión en un
 * teléfono de muelle: ni el drenado del siguiente operador ni su
 * `purgeConfirmed` tocan las entradas del anterior, así que el badge nunca
 * bajaba a 0 para el operador entrante (ver "Alcance del contador" en
 * docs/specs/spec-81-recogida-cola-offline.md).
 *
 * Cuenta también `sending`, no sólo `pending` — `useSyncQueue` corta su
 * polling cuando el conteo combinado llega a 0; una sola entrada huérfana en
 * `sending` (pestaña muerta a mitad de envío, antes de que `reclaimStale` la
 * recupere) haría caer el conteo a 0, deteniendo el polling y congelando la
 * pantalla en "todo subido" con el escaneo sin enviar de verdad.
 *
 * NO cuenta `dead` (B3, ronda 2 de review del PR #679) — antes lo hacía, y
 * `SyncChip.tsx` pinta `queuedCount > 0` en verde de éxito. Un escaneo
 * irrecuperablemente rechazado no es "todavía en cola" — es un bloqueo que
 * necesita ayuda humana, y mezclarlo con lo reintentable lo disfrazaba de
 * éxito para siempre. Ver `getBlockedPickupCount`, su contador hermano.
 */
/**
 * M-2, ronda 4 de review del PR #679 — una entrada `pending` cuyo manifiesto
 * está bloqueado (`manifestIsBlocked`: un `dead` en cualquier lugar, o un
 * `pending`/`sending` fresco de otro usuario por delante) no cuenta aquí —
 * pasa a `getBlockedPickupCount`. Sin esto, el badge "COLA N" pintaba en
 * verde de éxito algo que no iba a salir hasta que el otro usuario volviera
 * o pasaran `CROSS_USER_RECLAIM_MS` — la misma mentira que B3 corrigió para
 * `dead` en la ronda 2 (B2 lo había movido de `dead` a `pending` en vez de
 * eliminarlo), reintroducida por el bloqueo cross-user.
 *
 * `sending` siempre cuenta como pendiente (nunca bloqueada): es la entrada
 * activamente en vuelo, no una que espera detrás de otra.
 */
export async function getPendingPickupCount(operatorId: string): Promise<number> {
  const entries = await db.pickup_queue
    .where('operatorId')
    .equals(operatorId)
    .and((entry) => entry.status === 'pending' || entry.status === 'sending')
    .toArray();

  const isBlocked = createBlockedChecker(operatorId);
  let count = 0;
  for (const entry of entries) {
    if (entry.status === 'sending') {
      count += 1;
      continue;
    }
    if (!(await isBlocked(entry.manifestId, entry.userId))) count += 1;
  }
  return count;
}

/**
 * Cuántas entradas de la cola de Recogida de un operador quedaron `dead`:
 * un rechazo de negocio irrecuperable que agotó los reintentos. Separado de
 * `getPendingPickupCount` (B3, ronda 2 de review del PR #679) — necesitan
 * afordancias distintas: "sigue en cola, va a salir solo" contra "está
 * bloqueado, alguien tiene que intervenir".
 */
export async function getBlockedPickupCount(operatorId: string): Promise<number> {
  const entries = await db.pickup_queue
    .where('operatorId')
    .equals(operatorId)
    .and((entry) => entry.status === 'dead' || entry.status === 'pending')
    .toArray();

  const isBlocked = createBlockedChecker(operatorId);
  let count = 0;
  for (const entry of entries) {
    if (entry.status === 'dead') {
      count += 1;
      continue;
    }
    if (await isBlocked(entry.manifestId, entry.userId)) count += 1;
  }
  return count;
}

/**
 * M-2, ronda 5 de review del PR #679 (mayor) — `getPendingPickupCount`/
 * `getBlockedPickupCount` llamaban `manifestIsBlocked` una vez POR ENTRADA;
 * cada llamada hace 2 escaneos completos del índice
 * (`manifestHasDeadEntry` + `manifestHead`/`manifestBlockedForUser`).
 * `useSyncQueue` invoca ambos contadores cada `POLL_MS` (2s). Medido: N=200
 * (dentro del tope de 500 que declara `enqueue`) tardaba 21s por contador.
 *
 * El resultado de `manifestIsBlocked` sólo depende de `(manifestId, userId)`
 * — nunca de la entrada en sí — así que memoizarlo por esa clave reduce el
 * coste al número de pares distintos realmente presentes (unos pocos
 * manifiestos, cada uno con uno o dos dueños), no al número de entradas.
 */
function createBlockedChecker(
  operatorId: string,
): (manifestId: string, userId: string) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>();
  return (manifestId, userId) => {
    const key = `${manifestId}::${userId}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = manifestIsBlocked(db, operatorId, manifestId, userId);
      cache.set(key, cached);
    }
    return cached;
  };
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
