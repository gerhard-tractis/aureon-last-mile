/**
 * spec-82 fase 2 — Contrato puro de la caché de LECTURA offline de
 * Recogida ("DESCARGAR" de `5c`).
 *
 * Guardar/leer un snapshot de manifiesto+órdenes+bultos, y listar qué
 * externalLoadId están descargados para un operador. Sin DOM, sin React —
 * los hooks que leen/escriben desde una pantalla viven en
 * `hooks/pickup/useManifestDownload.ts`.
 *
 * Ver "Por qué una tabla nueva" y "Qué NO se precarga" en
 * docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md, fase 2.
 */
import type { AureonOfflineDB, CachedManifestOrder } from '../db';

/** Store mínimo que este módulo necesita — mismo patrón que
 * `PickupQueueStore` en `lib/offline/queue-claims.ts`: tipar contra la
 * forma real de Dexie, no contra un `AureonOfflineDB` completo, para que
 * los tests puedan pasar el `db` real sin más ceremonia.
 *
 * `transaction` incluido a partir de M5 (revisión de fase 2) —
 * `saveManifestSnapshot` necesita `db.transaction(...)` para que su
 * lectura-luego-escritura sea atómica; sin él, dos descargas concurrentes
 * del mismo `(operatorId, externalLoadId)` pueden leer "no existe todavía"
 * antes de que cualquiera escriba y terminar duplicando la fila. */
export type ManifestCacheStore = Pick<AureonOfflineDB, 'manifest_cache' | 'transaction'>;

export interface ManifestCacheSnapshot {
  operatorId: string;
  externalLoadId: string;
  manifestId: string;
  totalPackages: number | null;
  pickupRouteId: string | null;
  retailerName: string | null;
  pickupLocation: string | null;
  orders: CachedManifestOrder[];
}

export interface ManifestCacheRecord extends ManifestCacheSnapshot {
  downloadedAt: string;
}

/**
 * Guarda un snapshot, sobrescribiendo el anterior para el mismo
 * `(operatorId, externalLoadId)` en vez de acumular copias — una
 * re-descarga reemplaza, no duplica (ver el test de este comportamiento).
 *
 * M5, revisión de fase 2 — lectura-luego-escritura envuelta en una
 * transacción `'rw'` de Dexie: sin ella, dos llamadas concurrentes para el
 * mismo `(operatorId, externalLoadId)` (descargar A y B a la vez, o dos
 * pestañas) pueden leer "no existe todavía" ANTES de que cualquiera
 * escriba, y las dos terminan agregando — dejando dos filas donde
 * `getManifestSnapshot`/`.first()` sirve para siempre la más antigua.
 */
export async function saveManifestSnapshot(
  db: ManifestCacheStore,
  snapshot: ManifestCacheSnapshot,
): Promise<void> {
  const record = { ...snapshot, downloadedAt: new Date().toISOString() };

  await db.transaction('rw', db.manifest_cache, async () => {
    const existing = await db.manifest_cache
      .where('[operatorId+externalLoadId]')
      .equals([snapshot.operatorId, snapshot.externalLoadId])
      .first();

    if (existing?.id !== undefined) {
      await db.manifest_cache.update(existing.id, record);
    } else {
      await db.manifest_cache.add(record);
    }
  });
}

/**
 * `undefined` cuando esa carga nunca se descargó — nunca un objeto vacío
 * fabricado, para que el llamador no confunda "no lo sé" con "no hay nada".
 */
export async function getManifestSnapshot(
  db: ManifestCacheStore,
  operatorId: string,
  externalLoadId: string,
): Promise<ManifestCacheRecord | undefined> {
  return db.manifest_cache
    .where('[operatorId+externalLoadId]')
    .equals([operatorId, externalLoadId])
    .first();
}

/** `externalLoadId` de todo lo descargado por un operador. Lista vacía
 * (nunca `undefined`) cuando no hay nada — es una respuesta conocida, no
 * una ausencia de respuesta. */
export async function listDownloadedExternalLoadIds(
  db: ManifestCacheStore,
  operatorId: string,
): Promise<string[]> {
  const rows = await db.manifest_cache
    .where('operatorId')
    .equals(operatorId)
    .toArray();
  return rows.map((r) => r.externalLoadId);
}
