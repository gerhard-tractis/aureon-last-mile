/**
 * spec-81 fase 5 — Fotos: el blob capturado va a IndexedDB al momento de la
 * foto (vía `enqueueManifestPhoto`, sobre el mismo `pickup_queue` de fase 1
 * — reservado desde entonces en `PickupQueueEntry.blob`) y la subida al
 * bucket `manifests` queda diferida al drenador (`sendManifestPhoto`, en
 * `photos-send.ts`, el `OfflineQueueSender` de este tipo de entrada).
 *
 * Cierra el hueco que `complete/[loadId]/page.tsx` declara explícitamente:
 * `useUploadManifestDocument` (spec-80 fase 3) sube directo al bucket sin
 * ninguna ruta offline — si `upload` falla, el archivo se pierde. Mismo
 * contrato de "fila huérfana imposible" que ese hook ya cumple del lado
 * online (sube primero, inserta después, borra lo subido si el insert
 * falla), extendido al caso que ese hook no cubre: un reintento de la MISMA
 * foto, sin señal, en un manifiesto que ya trae `client_operation_id`
 * estable desde `enqueue` (fase 1) — nunca regenerado.
 *
 * No toca `ManifestPhotoStrip.tsx` ni la pantalla de captura — spec-80 fase
 * 4 (`5g`/`5h`) las está tocando en paralelo. Esta fase entrega la
 * infraestructura (encolar + drenar); conectar la UI de captura a ella es
 * trabajo de quien aterrice después sobre ese fichero.
 *
 * M-3, ronda 3 de review del PR #712 — este fichero es el lado de ENCOLAR;
 * `photos-send.ts` tiene el lado de ENVÍO, separados sólo por tamaño (había
 * pasado de 265 a 402 líneas, límite del repo: 300 — mismo motivo que fase 2
 * partió `queue.ts`/`queue-claims.ts`). Re-exportado más abajo para que
 * ningún llamador necesite saber que está partido en dos ficheros.
 */
import type { PickupQueueEntry } from '../db';
import type { PickupQueueStore } from './queue-claims';
import { enqueue } from './queue';
import { PICKUP_QUEUE_WAKE_EVENT } from '@/lib/offline/wake-event';
import type { ManifestPhotoPayload, EnqueueManifestPhotoInput } from './photos-types';

export type { ManifestPhotoPayload, EnqueueManifestPhotoInput } from './photos-types';
export type { SendManifestPhotoOptions } from './photos-send';
export {
  manifestPhotoStoragePath,
  sendManifestPhoto,
  createManifestPhotoSender,
} from './photos-send';

/**
 * "Riesgos" (spec-81) declara que, con blobs de fotos, el tope relevante
 * deja de ser el conteo de filas (`MAX_UNCONFIRMED_ENTRIES_PER_OPERATOR` en
 * `queue.ts`, 500) y pasa a ser bytes — una sola foto de cámara puede rondar
 * varios MB, así que 500 fotos sin confirmar llenarían la cuota del origen
 * mucho antes de tocar ese tope de filas.
 *
 * 200 MB por operador: generoso para varias hojas por carga y varias cargas
 * por ruta en una jornada (a ~2-4 MB por foto de cámara, decenas de fotos),
 * y muy por debajo de lo que un origen con `navigator.storage.persist()`
 * concedido (ver `requestPersistentStorage`, `lib/db.ts`) suele recibir en
 * un teléfono real (cientos de MB a varios GB, según
 * `navigator.storage.estimate()`). Superarlo rechaza el encolado con un
 * error explícito — el mismo criterio que el tope de filas: fallar visible
 * en vez de fallar en silencio contra la cuota real del navegador.
 */
export const MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR = 200 * 1024 * 1024;

/**
 * M2, review del PR #712 (mayor) — el bucket `manifests` tiene
 * `file_size_limit = 10485760` (10 MiB, ver
 * `20260430000001_create_manifests_storage_bucket.sql`). Sin este tope
 * propio, una foto por encima de ese límite sube en cada intento del
 * drenador, el bucket la rechaza con un error no reconocido → `retry` ×
 * `MAX_RETRY_ATTEMPTS` → `dead` → manifiesto bloqueado sin salida, subiendo
 * y borrando el mismo blob en cada vuelta. Rechazarla aquí, al encolar, es
 * el único punto donde el operario todavía puede repetir la foto (más
 * comprimida o recortada) en vez de perder la sesión entera contra un
 * límite del bucket que el drenador de fondo nunca podría negociar.
 *
 * n1, ronda 3 de review del PR #712 (menor) — mismo valor que el
 * `file_size_limit` real del bucket, duplicado también en la validación de
 * captura de spec-80 fase 4 (#713, en paralelo). Dos copias de la misma
 * constante en dos PRs del mismo día — no se unifica aquí porque tocaría una
 * rama ajena en vuelo; anotado para cuando ambas mergeen.
 */
export const MAX_PHOTO_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Bytes de fotos sin confirmar (`status !== 'sent'`) en cola para un
 * operador — lo que `MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR` limita.
 * `dead`/`sending` cuentan a propósito: un blob `dead` sigue ocupando disco
 * hasta que un humano lo resuelva (ver fase 4, afordancia de `dead`), y uno
 * `sending` está en vuelo, no confirmado todavía.
 */
export async function unconfirmedPhotoBytes(
  db: PickupQueueStore,
  operatorId: string,
): Promise<number> {
  const entries = await db.pickup_queue
    .where('operatorId')
    .equals(operatorId)
    .and((entry) => entry.type === 'manifest_photo' && entry.status !== 'sent')
    .toArray();
  return entries.reduce((total, entry) => total + (entry.blob?.size ?? 0), 0);
}

/**
 * B3, review del PR #712 (bloqueante) — `ManifestPhotoStrip.tsx` calcula el
 * número de hoja contra `useManifestDocuments`, una query AL SERVIDOR. Sin
 * señal esa lista queda congelada, así que dos fotos capturadas offline en
 * el MISMO dispositivo reciben el MISMO número propuesto — no es una
 * carrera rara: es el caso normal del flujo que esta fase existe para
 * cubrir.
 *
 * Desambigua contra lo único consultable offline: la cola LOCAL. Devuelve
 * el primer número ≥ `requested` que ningún `manifest_photo` sin confirmar
 * (`status !== 'sent'`) de este manifiesto ya está usando — `sent` no
 * cuenta: ese número ya lo decidió el servidor, y es la fuente de verdad
 * para él. Deliberadamente sin filtrar por `userId` ni por `status` más allá
 * de excluir `sent` (M-1, ronda 3 de review — un mutante que restringía a
 * sólo `pending` sobrevivía porque ningún test sembraba `sending`/`dead`/
 * otro usuario; ver `photos.test.ts`): una entrada `sending` puede ya haber
 * insertado su fila en el servidor con ese número, y una `dead` sigue
 * ocupando ese número hasta que un humano la resuelva.
 *
 * No resuelve la colisión entre DOS DISPOSITIVOS distintos capturando para
 * el mismo manifiesto sin haber sincronizado nunca entre sí — ninguna cola
 * puramente local puede verla venir. Ese caso, mucho más raro, cae en el
 * 23505 de `sendManifestPhoto` (`photos-send.ts`), que desde la ronda 3 de
 * review **renumera y reintenta** en vez de matar — ver el docstring de
 * `nextServerAvailableSheetNumber` ahí.
 */
async function nextAvailableSheetNumber(
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
  requested: number,
): Promise<number> {
  const queued = await db.pickup_queue
    .where('operatorId')
    .equals(operatorId)
    .and((entry) => entry.manifestId === manifestId && entry.type === 'manifest_photo' && entry.status !== 'sent')
    .toArray();
  const taken = new Set(queued.map((entry) => (entry.payload as ManifestPhotoPayload).sheetNumber));

  let candidate = requested;
  while (taken.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

/**
 * Encola una foto de manifiesto. Delega en `enqueue` (fase 1) para el
 * `client_operation_id` estable y el tope de 500 filas; añade dos topes
 * propios antes de escribir — por fichero (`MAX_PHOTO_FILE_BYTES`, el límite
 * real del bucket) y por operador en bytes acumulados
 * (`MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR`) — y renumera contra colisión
 * local (B3, `nextAvailableSheetNumber`) antes de encolar. Rechazar ANTES de
 * escribir es lo que evita que el propio intento de encolar sea el que
 * agote la cuota real de IndexedDB o produzca un envío condenado a `dead`.
 *
 * M1, review del PR #712 (mayor) — despierta el drenador
 * (`PICKUP_QUEUE_WAKE_EVENT`) tras un encolado que sí se aplicó, mismo
 * patrón que `complete/[loadId]/page.tsx` ya usa tras encolar un
 * `close_manifest` offline. `AppLayout` monta `useOfflineQueue` una única
 * vez a nivel de shell; sin esto, una foto encolada mientras la pestaña
 * sigue abierta (el caso normal: el operario sigue en la pantalla de
 * captura) espera a un evento `online` real que puede no llegar nunca si la
 * señal nunca se recuperó de verdad a nivel de red — sólo falló ese upload
 * puntual, o el dispositivo ya estaba offline antes de abrir la cámara.
 */
export async function enqueueManifestPhoto(
  db: PickupQueueStore,
  input: EnqueueManifestPhotoInput,
): Promise<PickupQueueEntry> {
  if (input.blob.size > MAX_PHOTO_FILE_BYTES) {
    const limitMb = Math.round(MAX_PHOTO_FILE_BYTES / (1024 * 1024));
    // Ronda 2 de review del PR #736 (menor) — sin el prefijo interno
    // "recogida offline queue: ": spec-80 fase 6 empezó a mostrar este
    // mensaje tal cual en un `toast.error` frente al conductor
    // (`ManifestPhotoStrip.tsx`), y ese prefijo no significa nada para él.
    throw new Error(
      `la foto supera el tamaño máximo (${limitMb} MiB) que el bucket admite — repite la captura antes de continuar`,
    );
  }

  const currentBytes = await unconfirmedPhotoBytes(db, input.operatorId);
  if (currentBytes + input.blob.size > MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR) {
    const capMb = Math.round(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR / (1024 * 1024));
    throw new Error(
      `cola de fotos llena (${capMb} MB sin confirmar) para este operador — no se puede encolar más hasta que el drenado confirme o descarte alguna`,
    );
  }

  const sheetNumber = await nextAvailableSheetNumber(
    db,
    input.operatorId,
    input.manifestId,
    input.sheetNumber,
  );
  const payload: ManifestPhotoPayload = { sheetNumber };
  const entry = await enqueue(db, {
    operatorId: input.operatorId,
    userId: input.userId,
    manifestId: input.manifestId,
    externalLoadId: input.externalLoadId,
    type: 'manifest_photo',
    payload,
    blob: input.blob,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PICKUP_QUEUE_WAKE_EVENT));
  }

  return entry;
}
