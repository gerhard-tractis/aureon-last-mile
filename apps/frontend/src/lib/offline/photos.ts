/**
 * spec-81 fase 5 — Fotos: el blob capturado va a IndexedDB al momento de la
 * foto (vía `enqueueManifestPhoto`, sobre el mismo `pickup_queue` de fase 1
 * — reservado desde entonces en `PickupQueueEntry.blob`) y la subida al
 * bucket `manifests` queda diferida al drenador (`sendManifestPhoto`, el
 * `OfflineQueueSender` de este tipo de entrada).
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
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PickupQueueEntry } from '../db';
import type { PickupQueueStore } from './queue-claims';
import { enqueue } from './queue';
import type { OfflineQueueOutcome, OfflineQueueSender } from '@/hooks/useOfflineQueue';
import { PICKUP_QUEUE_WAKE_EVENT } from '@/hooks/useOfflineQueue';

export interface ManifestPhotoPayload {
  sheetNumber: number;
  // Índice compatible con `EnqueueInput.payload`/`PickupQueueEntry.payload`
  // (`Record<string, unknown>`, `queue.ts`) — sin esto, TS rechaza tanto
  // asignar este tipo a esa forma (al encolar) como el cast inverso (al leer
  // `entry.payload` en el drenador), porque un tipo sin índice no es
  // estructuralmente un `Record<string, unknown>`.
  [key: string]: unknown;
}

export interface EnqueueManifestPhotoInput {
  operatorId: string;
  userId: string;
  manifestId: string;
  sheetNumber: number;
  blob: Blob;
}

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
 * cubrir. Sin desambiguar, la segunda choca en el drenador contra un
 * `sheet_number` ya usado por OTRO `storage_path` → 23505 leído como
 * colisión real → `dead` → `manifestHasDeadEntry` bloquea también el
 * `close_manifest` de la carga entera, sin salida (`retryDead` repite la
 * misma colisión).
 *
 * Desambigua contra lo único consultable offline: la cola LOCAL. Devuelve
 * el primer número ≥ `requested` que ningún `manifest_photo` sin confirmar
 * (`status !== 'sent'`) de este manifiesto ya está usando — `sent` no
 * cuenta: ese número ya lo decidió el servidor, y es la fuente de verdad
 * para él.
 *
 * No resuelve la colisión entre DOS DISPOSITIVOS distintos capturando para
 * el mismo manifiesto sin haber sincronizado nunca entre sí — ninguna cola
 * puramente local puede verla venir. Ese caso, mucho más raro (fuera de la
 * ventana de `CROSS_USER_RECLAIM_MS`, además), sigue cayendo en el 23505
 * "colisión real" de `sendManifestPhoto` — `dead`, con la misma afordancia
 * humana ("REQUIERE AYUDA") que cualquier otro bloqueo irrecuperable de esta
 * cola. Documentado explícitamente, no un caso silenciosamente cubierto.
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
    throw new Error(
      `recogida offline queue: la foto supera el tamaño máximo (${limitMb} MiB) que el bucket admite — repite la captura antes de continuar`,
    );
  }

  const currentBytes = await unconfirmedPhotoBytes(db, input.operatorId);
  if (currentBytes + input.blob.size > MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR) {
    const capMb = Math.round(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR / (1024 * 1024));
    throw new Error(
      `recogida offline queue: cola de fotos llena (${capMb} MB sin confirmar) para este operador — no se puede encolar más hasta que el drenado confirme o descarte alguna`,
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
    type: 'manifest_photo',
    payload,
    blob: input.blob,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PICKUP_QUEUE_WAKE_EVENT));
  }

  return entry;
}

/**
 * Ruta determinista en el bucket `manifests` — misma convención de prefijo
 * que `useUploadManifestDocument` (`operator_id/manifest_id/…`), con el
 * `client_operation_id` de la entrada (estable, nunca regenerado en un
 * reintento — `enqueue`, fase 1) en vez de `Date.now()`. Calcularla siempre
 * a partir de la entrada, nunca guardarla aparte: así un reintento sube al
 * MISMO objeto (`upsert: true`, más abajo) en vez de crear uno nuevo cada
 * vez, y el insert puede reconocer "esta fila ya referencia lo que acabamos
 * de volver a subir" comparando la ruta, sin una columna de idempotencia
 * nueva en `manifest_documents`.
 */
export function manifestPhotoStoragePath(entry: PickupQueueEntry): string {
  const { sheetNumber } = entry.payload as ManifestPhotoPayload;
  return `${entry.operatorId}/${entry.manifestId}/sheet-${sheetNumber}-${entry.clientOperationId}.jpg`;
}

const FETCH_FAILURE_PATTERN = /fetch|network|load failed/i;

/**
 * Errores de `@supabase/storage-js`: un fallo de red produce
 * `StorageUnknownError` (ver `storage-js/src/lib/fetch.ts` — cualquier
 * rechazo de `fetch` que no sea una respuesta HTTP con cuerpo JSON de error
 * cae aquí). Un rechazo real del servidor (bucket sin permiso, archivo
 * duplicado sin `upsert`, cuota del bucket) es `StorageApiError`, con
 * `status`/`statusCode` reales — nunca esta forma. El nombre es la señal
 * primaria; el patrón de mensaje es respaldo para el objeto sin `name` que
 * un mock o un runtime distinto pudiera producir.
 */
function isStorageNetworkFailure(err: { name?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.name === 'StorageUnknownError') return true;
  return FETCH_FAILURE_PATTERN.test(err.message ?? '');
}

/**
 * Errores de `postgrest-js` sobre `.insert()`: igual que
 * `classifyCloseManifestError` (spec-80/81 fase 2) documenta para
 * `close_manifest`, un fallo de `fetch` no rechaza — `PostgrestBuilder`
 * resuelve con `{ code: '', message: "<Name>: <message>", ... }`. Un
 * rechazo real de Postgres SIEMPRE trae un SQLSTATE de 5 caracteres, nunca
 * la cadena vacía. `manifest_documents` no tiene centinelas de texto que
 * distinguir (a diferencia de `close_manifest`), así que `code === ''` basta
 * como única señal.
 */
function isPostgrestNetworkFailure(err: { code?: string } | null): boolean {
  return err !== null && err.code === '';
}

/**
 * El `OfflineQueueSender` de una entrada `manifest_photo`. Sube al bucket
 * `manifests` y sólo si la subida tiene éxito inserta la fila en
 * `manifest_documents` — nunca al revés (checklist de esta fase). Ningún
 * `AbortSignal.timeout` propio (a diferencia de `close_manifest`,
 * `CLOSE_MANIFEST_TIMEOUT_MS` en `offlineQueueSender.ts`): una foto puede
 * legítimamente tardar más que una firma en 2G, y a diferencia de
 * `close_manifest` (que muta estado de negocio en el servidor —
 * `signature_operator_name`), reclamar esta entrada como huérfana
 * (`reclaimStale`) y reintentar antes de que la primera petición termine es
 * inofensivo aquí: la ruta de subida es determinista y `upsert: true`, así
 * que un segundo intento en vuelo sube al mismo objeto sin crear un
 * duplicado.
 */
export async function sendManifestPhoto(
  supabase: SupabaseClient,
  entry: PickupQueueEntry,
): Promise<OfflineQueueOutcome> {
  if (!entry.blob) {
    return {
      outcome: 'dead',
      reason: 'manifest_photo entry sin blob adjunto — no hay nada que subir',
    };
  }
  const { sheetNumber } = entry.payload as ManifestPhotoPayload;
  const storagePath = manifestPhotoStoragePath(entry);

  // M2, review del PR #712 — `contentType` explícito con el `.type` real del
  // blob capturado, no inferido del nombre del objeto (`manifestPhotoStoragePath`
  // siempre termina en `.jpg`, sin importar el tipo real — un HEIC de iOS
  // subido con ese nombre acabaría con un content-type equivocado si se deja
  // que storage-js lo infiera de la extensión).
  const { error: uploadError } = await supabase.storage
    .from('manifests')
    .upload(storagePath, entry.blob, { upsert: true, contentType: entry.blob.type });
  if (uploadError) {
    if (isStorageNetworkFailure(uploadError)) {
      return { outcome: 'offline', reason: uploadError.message };
    }
    return { outcome: 'retry', reason: uploadError.message };
  }

  // B2, review del PR #712 (bloqueante) — `uploaded_by` NUNCA viene de
  // `entry.userId` (la identidad de quien ENCOLÓ, congelada en la entrada).
  // `drainManifest` procesa la cabeza del FIFO sea de quien sea, pasado
  // `CROSS_USER_RECLAIM_MS` (`queue-blocking.ts`) — decisión del usuario,
  // aceptada porque `close_manifest` deriva el firmante de `auth.uid()` EN
  // EL SERVIDOR, nunca del payload. `manifest_photo` fue el primer tipo de
  // esta cola en llevar la identidad del actor en el payload, y eso rompía
  // esa premisa: B (bajo su propio JWT) drenando la foto que A capturó
  // insertaba `uploaded_by = A`, y la policy `uploaded_by IS NULL OR
  // uploaded_by = auth.uid()` (`20260918000001_spec80_fase3_manifest_documents.sql`)
  // lo rechazaba con 42501 — retry × `MAX_RETRY_ATTEMPTS` → `dead` →
  // manifiesto bloqueado para siempre, subiendo y borrando el mismo blob en
  // cada vuelta. La policy admite `NULL` explícitamente para este caso; no
  // hay sesión fiable de la que derivarlo en un drenador de fondo.
  const { error: insertError } = await supabase.from('manifest_documents').insert({
    operator_id: entry.operatorId,
    manifest_id: entry.manifestId,
    storage_path: storagePath,
    sheet_number: sheetNumber,
    uploaded_by: null,
  });

  if (!insertError) {
    return { outcome: 'sent' };
  }

  // Fallo de red DURANTE el insert (tras una subida que sí tuvo éxito): no
  // se sabe si se aplicó o no. No se borra el objeto — el próximo reintento
  // reutiliza la misma ruta determinista sin coste — y se reporta `offline`,
  // no `retry`, para no gastar presupuesto de reintentos por una caída de
  // señal (mismo contrato que la costura 1 de fase 2 para `close_manifest`).
  if (isPostgrestNetworkFailure(insertError)) {
    return { outcome: 'offline', reason: insertError.message };
  }

  if (insertError.code === '23505') {
    // Reintento de la MISMA foto — la subida es idempotente por
    // construcción (mismo path determinista, `upsert: true`); si la fila que
    // ya existe referencia exactamente ese objeto, el insert anterior SÍ se
    // aplicó y sólo se perdió la respuesta. No es un huérfano — no hay nada
    // que limpiar ni fila nueva que crear.
    const { data: existing, error: selectError } = await supabase
      .from('manifest_documents')
      .select('storage_path')
      .eq('operator_id', entry.operatorId)
      .eq('manifest_id', entry.manifestId)
      .eq('sheet_number', sheetNumber)
      .is('deleted_at', null)
      .maybeSingle();

    // B1, review del PR #712 (bloqueante) — un `existing === null` NO
    // significa "es una colisión real" cuando la SELECT que lo produjo
    // falló: es el reintento NORMAL de esta cola (el insert anterior SÍ se
    // aplicó) leído a ciegas. Si la señal cae DE NUEVO justo entre el 23505
    // y esta verificación, `existing` es `null` por el fallo de red, no
    // porque la fila no exista — tratarlo como colisión real borraba el
    // objeto que la fila VIVA en `manifest_documents` referencia: evidencia
    // legal apuntando a un objeto inexistente, y `retryDead` no lo salva
    // (revive, repite el mismo 23505, vuelve a fallar la misma SELECT sin
    // señal, vuelve a morir). No se borra nada mientras no se sepa de
    // verdad — `offline` si la SELECT falló por red (mismo criterio que el
    // resto de esta función), `retry` para cualquier otro fallo no
    // reconocido de la SELECT misma.
    if (selectError) {
      if (isPostgrestNetworkFailure(selectError)) {
        return { outcome: 'offline', reason: selectError.message };
      }
      return { outcome: 'retry', reason: selectError.message };
    }

    if (existing && (existing as { storage_path: string }).storage_path === storagePath) {
      return { outcome: 'sent' };
    }

    // Colisión real: otra foto ya ocupa este número de hoja. Con B3
    // (`nextAvailableSheetNumber`, `enqueueManifestPhoto`) esto deja de ser
    // el caso normal de dos capturas offline en el MISMO dispositivo — sólo
    // ocurre entre DOS DISPOSITIVOS que nunca sincronizaron entre sí, algo
    // que ninguna cola puramente local puede prevenir. Reintentar no
    // resuelve un número ya ocupado por OTRO objeto — limpiar lo que
    // acabamos de subir (huérfano evitable, mismo contrato que
    // `useUploadManifestDocument`) y dar por muerta, con la misma
    // afordancia humana que cualquier otro `dead` de esta cola.
    const { error: removeError } = await supabase.storage.from('manifests').remove([storagePath]);
    if (removeError) {
      console.error(
        'Failed to remove orphaned manifest photo after sheet_number collision:',
        removeError,
      );
    }
    return { outcome: 'dead', reason: `sheet_number ${sheetNumber} ya está ocupado por otra foto` };
  }

  // Cualquier otro rechazo del insert (RLS, timeout, deadlock…): fila
  // huérfana imposible — el objeto que acabamos de subir no puede quedar sin
  // una fila que lo referencie. Mismo valor por defecto seguro que el resto
  // de esta cola: reintentar, no matar, un rechazo no reconocido.
  const { error: removeError } = await supabase.storage.from('manifests').remove([storagePath]);
  if (removeError) {
    console.error('Failed to remove orphaned manifest photo after insert failure:', removeError);
  }
  return { outcome: 'retry', reason: insertError.message };
}

export function createManifestPhotoSender(supabase: SupabaseClient): OfflineQueueSender {
  return (entry: PickupQueueEntry) => sendManifestPhoto(supabase, entry);
}
