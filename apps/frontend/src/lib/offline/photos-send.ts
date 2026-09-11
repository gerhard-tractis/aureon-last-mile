/**
 * spec-81 fase 5 — lado de ENVÍO de la cola offline de fotos de manifiesto.
 * `photos.ts` tiene el lado de ENCOLAR; separados sólo por tamaño de
 * fichero (M-3, review del PR #712 — el mismo motivo que fase 2 partió
 * `queue.ts`/`queue-claims.ts`), mismo contrato, re-exportado desde
 * `photos.ts` para que ningún llamador necesite saber que está partido.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PickupQueueEntry } from '../db';
import type { PickupQueueStore } from './queue-claims';
import type { OfflineQueueOutcome, OfflineQueueSender } from '@/hooks/useOfflineQueue';
import type { ManifestPhotoPayload } from './photos-types';

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
 *
 * B-1, ronda 3 de review del PR #712 — sigue siendo determinista tras el
 * renumerado por colisión (más abajo): un `sheetNumber` distinto produce una
 * ruta distinta, así que el objeto viejo (bajo el número que colisionó) no
 * se reutiliza — se limpia explícitamente antes de renumerar.
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
 * Errores de `postgrest-js`: igual que `classifyCloseManifestError`
 * (spec-80/81 fase 2) documenta para `close_manifest`, un fallo de `fetch`
 * no rechaza — `PostgrestBuilder` resuelve con
 * `{ code: '', message: "<Name>: <message>", ... }`. Un rechazo real de
 * Postgres SIEMPRE trae un SQLSTATE de 5 caracteres, nunca la cadena vacía.
 * Ni `manifest_documents` ni esta función tienen centinelas de texto que
 * distinguir (a diferencia de `close_manifest`), así que `code === ''`
 * basta como única señal.
 */
function isPostgrestNetworkFailure(err: { code?: string } | null): boolean {
  return err !== null && err.code === '';
}

/**
 * B-1, ronda 3 de review del PR #712 (bloqueante, parte 1) — el
 * `manifestHasDeadEntry` original se escribió para `pickup_scan`, cuyo
 * fallo corrompe el CONTEO que el cliente firma; matar el manifiesto entero
 * era correcto ahí. Una foto es respaldo, no conteo: su pérdida no falsea
 * la cifra firmada. Decisión del usuario: una colisión de `sheet_number` NO
 * muere — el número es una etiqueta de presentación ("hoja N" en la tira),
 * no una identidad — se renumera contra la fuente de verdad real del
 * conflicto (el servidor, ya que la colisión ES con una fila del servidor)
 * y se reintenta.
 *
 * Devuelve el error si la consulta misma falla (sin red, sin permiso…) — en
 * ese caso el llamador reintenta más tarde sin renumerar todavía; el mismo
 * 23505 se repetirá y esta función se volverá a intentar en la próxima
 * pasada del drenador.
 *
 * Menor, ronda 4 de review del PR #712 — el número que devuelve ya NO es
 * sólo "el máximo del servidor + 1": también evita cualquier `sheetNumber`
 * que la cola LOCAL de este manifiesto ya esté usando (`status !== 'sent'`,
 * mismo conjunto que `nextAvailableSheetNumber` en `photos.ts` calcula al
 * encolar). Medido por el reviewer: con dos fotos locales — una ya en la
 * hoja 8 — y el servidor en `MAX=7`, renumerar sin este chequeo proponía 8
 * de nuevo, chocando con la otra entrada local; converge en la vuelta
 * siguiente, pero cada choque consume una unidad de `MAX_RETRY_ATTEMPTS`
 * que un error transitorio real necesita.
 */
async function nextAvailableSheetNumberAfterCollision(
  supabase: SupabaseClient,
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
): Promise<{ sheetNumber: number } | { error: string }> {
  const { data, error } = await supabase
    .from('manifest_documents')
    .select('sheet_number')
    .eq('operator_id', operatorId)
    .eq('manifest_id', manifestId)
    .is('deleted_at', null)
    .order('sheet_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  const maxUsed = (data as { sheet_number: number } | null)?.sheet_number ?? 0;

  const queuedLocally = await db.pickup_queue
    .where('operatorId')
    .equals(operatorId)
    .and(
      (e) => e.manifestId === manifestId && e.type === 'manifest_photo' && e.status !== 'sent',
    )
    .toArray();
  const takenLocally = new Set(
    queuedLocally.map((e) => (e.payload as ManifestPhotoPayload).sheetNumber),
  );

  let candidate = maxUsed + 1;
  while (takenLocally.has(candidate)) {
    candidate += 1;
  }
  return { sheetNumber: candidate };
}

/**
 * El `OfflineQueueSender` de una entrada `manifest_photo`. Sube al bucket
 * `manifests` y sólo si la subida tiene éxito inserta la fila en
 * `manifest_documents` — nunca al revés (checklist de la fase). Ningún
 * `AbortSignal.timeout` propio (a diferencia de `close_manifest`,
 * `CLOSE_MANIFEST_TIMEOUT_MS` en `offlineQueueSender.ts` — ver el docstring
 * de `RECLAIM_STALE_MS` en `useOfflineQueue.ts` para la excepción completa):
 * una foto puede legítimamente tardar más que una firma en 2G, y a
 * diferencia de `close_manifest` (que muta estado de negocio en el servidor
 * — `signature_operator_name`), reclamar esta entrada como huérfana
 * (`reclaimStale`) y reintentar antes de que la primera petición termine es
 * inofensivo aquí: la ruta de subida es determinista y `upsert: true`, así
 * que un segundo intento en vuelo sube al mismo objeto sin crear un
 * duplicado.
 *
 * `db`, ronda 3 de review del PR #712 (B-1) — necesario para escribir el
 * `sheetNumber` renumerado de vuelta en la entrada encolada cuando una
 * colisión se resuelve (más abajo); el resto de esta función sólo lee
 * `entry`, que ya llega con los datos vigentes desde el drenador.
 */
export interface SendManifestPhotoOptions {
  /**
   * B-2 (ronda 3) + menor (ronda 4) de review del PR #712 — se dispara
   * cuando esta llamada tiene evidencia de que
   * `['pickup','manifest-documents', manifestId]` cambió o quedó
   * desactualizada en el cliente: un envío que SÍ se aplicó (`sent`), o un
   * 23505 que reveló una fila del servidor que la tira no conocía
   * (renumerado por colisión, más abajo — "acaba de descubrir que el
   * servidor tiene una fila que la tira no conoce", el mismo estado que B-2
   * vino a arreglar). `AppLayout.tsx` lo usa para invalidar esa query.
   */
  onManifestDocumentsChanged?: (entry: PickupQueueEntry) => void;
}

export async function sendManifestPhoto(
  supabase: SupabaseClient,
  db: PickupQueueStore,
  entry: PickupQueueEntry,
  options: SendManifestPhotoOptions = {},
): Promise<OfflineQueueOutcome> {
  if (!entry.blob || entry.id === undefined) {
    return {
      outcome: 'dead',
      reason: 'manifest_photo entry sin blob adjunto o sin id — no hay nada que subir',
    };
  }
  const { sheetNumber } = entry.payload as ManifestPhotoPayload;
  const storagePath = manifestPhotoStoragePath(entry);

  // M2, review del PR #712 — `contentType` explícito con el `.type` real del
  // blob capturado, no inferido del nombre del objeto
  // (`manifestPhotoStoragePath` siempre termina en `.jpg`, sin importar el
  // tipo real). `|| 'image/jpeg'` (menor, ronda 3) — un `Blob`/`File` sin
  // MIME (medido: algunos `<input capture>` en Android lo dejan vacío) manda
  // `contentType: ''`, que el bucket con lista blanca de MIME rechaza de
  // forma PERMANENTE (`dead` tras agotar reintentos) por algo que
  // reintentar nunca arregla.
  const { error: uploadError } = await supabase.storage
    .from('manifests')
    .upload(storagePath, entry.blob, { upsert: true, contentType: entry.blob.type || 'image/jpeg' });
  if (uploadError) {
    if (isStorageNetworkFailure(uploadError)) {
      return { outcome: 'offline', reason: uploadError.message };
    }
    return { outcome: 'retry', reason: uploadError.message };
  }

  // M-4, ronda 3 de review del PR #712 (mayor) — `uploaded_by` NO puede ser
  // `entry.userId` (B2, ronda 1: rompía la policy cross-user) NI un `null`
  // fijo (M-4: sobre una tabla cuyo COMMENT dice "es el respaldo si después
  // falta un paquete", `null` fijo dejaba la columna medio poblada — no-nula
  // online, siempre nula offline). Se resuelve de la SESIÓN QUE DRENA en el
  // momento del envío — la misma fuente que la policy compara
  // (`uploaded_by IS NULL OR uploaded_by = auth.uid()`).
  //
  // Corrección de la ronda 4 — este campo registra quién SUBIÓ la fila, NO
  // quién CAPTURÓ la foto; en el escenario cross-user que motivó B2 son
  // personas distintas (B, bajo su propia sesión, drenando lo que A
  // fotografió), y "quién capturó" no se persiste en ningún sitio — el
  // `userId` de la entrada vive sólo en IndexedDB y `purgeConfirmed` lo
  // borra. La afirmación de la ronda 3 ("cierra el hueco de trazabilidad de
  // quién fotografió") era falsa; lo que sí es cierto es que la columna deja
  // de estar sistemáticamente vacía en la ruta offline.
  //
  // `getSession()`, no `getUser()` (bloqueante, ronda 4) — medido contra
  // `@supabase/auth-js@2.72.0` (`GoTrueClient.js:1179-1226`): `getUser()` es
  // SIEMPRE una llamada de RED real (un round-trip por foto), pasa por
  // `_acquireLock(-1, …)` — espera de lock SIN TIMEOUT, así que un lock de
  // GoTrue atascado en otra pestaña deja esta entrada `sending` hasta que
  // `reclaimStale` la libere a los 90s — y su `catch` puede disparar
  // `_removeSession()` (`AuthSessionMissingError`) por una sesión REVOCADA
  // en el servidor, cerrando la sesión local del conductor a media jornada
  // por una subida de foto en segundo plano.
  //
  // Corrección de la ronda 5 — `getSession()` NO es puramente local; la
  // afirmación absoluta de la ronda 4 era incorrecta en los tres puntos,
  // medido en la misma fuente instalada: también pasa por
  // `_acquireLock(-1, …)` (`GoTrueClient.js:1018-1026`, el mismo lock sin
  // timeout, no eliminado); llama a `_callRefreshToken(...)` — RED real —
  // si el token está dentro de `EXPIRY_MARGIN_MS` de expirar (`:1162`); y sí
  // llama a `_removeSession()` si la sesión guardada no pasa
  // `_isValidSession` (`:1120`). El cambio sigue siendo correcto y una
  // mejora real: la red sólo ocurre cuando el token está por caducar (y ahí
  // YA hubo red — venimos de una subida al bucket que tuvo éxito, así que
  // hay señal), y `_removeSession` sólo dispara por almacenamiento local
  // corrupto, no por "sesión revocada en el servidor" — el camino realista
  // de `getUser()` que sí podía cerrar la sesión de un conductor activo sin
  // ninguna razón real. `try/catch` de todas formas: sin él, una excepción
  // aquí (de cualquiera de los tres caminos de arriba) escapaba de
  // `sendManifestPhoto` DESPUÉS de una subida ya exitosa sin limpiar el
  // objeto — el único camino post-subida que rompía "fila huérfana
  // imposible", el contrato que esta fase defiende en todas las demás
  // ramas. Verificado por ejecución (ronda 5): con `getSession` lanzando, la
  // función continúa y limpia el objeto (`remove` se llama).
  let uploadedBy: string | null = null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    uploadedBy = sessionData?.session?.user?.id ?? null;
  } catch {
    // Sin sesión resoluble: cae a `null`, que la policy admite
    // explícitamente, en vez de fallar la subida entera por esto.
  }

  const { error: insertError } = await supabase.from('manifest_documents').insert({
    operator_id: entry.operatorId,
    manifest_id: entry.manifestId,
    storage_path: storagePath,
    sheet_number: sheetNumber,
    uploaded_by: uploadedBy,
  });

  if (!insertError) {
    options.onManifestDocumentsChanged?.(entry);
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

    // B1, ronda 1 de review del PR #712 (bloqueante) — un `existing === null`
    // NO significa "es una colisión real" cuando la SELECT que lo produjo
    // falló: es el reintento NORMAL de esta cola (el insert anterior SÍ se
    // aplicó) leído a ciegas. No se borra nada mientras no se sepa de verdad
    // — `offline` si la SELECT falló por red, `retry` para cualquier otro
    // fallo no reconocido de la SELECT misma.
    if (selectError) {
      if (isPostgrestNetworkFailure(selectError)) {
        return { outcome: 'offline', reason: selectError.message };
      }
      return { outcome: 'retry', reason: selectError.message };
    }

    if (existing && (existing as { storage_path: string }).storage_path === storagePath) {
      return { outcome: 'sent' };
    }

    // B-1, ronda 3 de review del PR #712 (bloqueante, parte 1) — colisión
    // real: otra foto ya ocupa este número de hoja. Antes se daba por
    // muerta aquí; ahora se renumera y se reintenta (ver el docstring de
    // `nextServerAvailableSheetNumber`). Se limpia primero el objeto que
    // subimos bajo el número viejo — la ruta es determinista por
    // `sheetNumber`, así que un número nuevo sube a una ruta DISTINTA, y el
    // objeto bajo el número colisionado quedaría huérfano si no se borra
    // aquí.
    const { error: removeError } = await supabase.storage.from('manifests').remove([storagePath]);
    if (removeError) {
      console.error(
        'Failed to remove orphaned manifest photo after sheet_number collision:',
        removeError,
      );
    }

    const next = await nextAvailableSheetNumberAfterCollision(
      supabase,
      db,
      entry.operatorId,
      entry.manifestId,
    );
    if ('error' in next) {
      // No se pudo determinar el siguiente número disponible (sin red, sin
      // permiso…) — reintentar más tarde con el MISMO número; la próxima
      // pasada repetirá este mismo 23505 y volverá a intentar renumerar.
      return {
        outcome: 'retry',
        reason: `sheet_number ${sheetNumber} ocupado; no se pudo determinar el siguiente número disponible: ${next.error}`,
      };
    }

    await db.pickup_queue.update(entry.id, {
      payload: { sheetNumber: next.sheetNumber } satisfies ManifestPhotoPayload,
    });
    // Menor, ronda 4 de review del PR #712 — este 23505 acaba de revelar que
    // el servidor tiene una fila (la que causó la colisión) que la tira
    // puede no conocer todavía. Mismo motivo que B-2: invalidar aquí cierra
    // el círculo en vez de esperar al próximo `sent`.
    options.onManifestDocumentsChanged?.(entry);
    return {
      outcome: 'retry',
      reason: `sheet_number ${sheetNumber} ya estaba ocupado por otra foto — renumerada a ${next.sheetNumber} y reintentando`,
    };
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

export function createManifestPhotoSender(
  supabase: SupabaseClient,
  db: PickupQueueStore,
  options: SendManifestPhotoOptions = {},
): OfflineQueueSender {
  return (entry: PickupQueueEntry) => sendManifestPhoto(supabase, db, entry, options);
}
