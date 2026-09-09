/**
 * spec-80 fase 4 (5g) — validación del `File` que entrega el fallback
 * `<input type="file" capture="environment">` antes de entregarlo como
 * respaldo fotográfico del manifiesto.
 *
 * Debe seguir exactamente a la definición del bucket privado `manifests`
 * (packages/database/supabase/migrations/20260430000001_create_manifests_storage_bucket.sql,
 * `file_size_limit`/`allowed_mime_types`) — si diverge, el rechazo pasa de
 * "aquí, con el operario delante" a "horas después, drenando la cola de
 * spec-81, sin nadie para repetir la foto".
 */
export const MANIFEST_BUCKET_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MANIFEST_BUCKET_ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

// M-B, ronda 3 de review del PR #713 — varios WebViews de Android y
// proveedores de fichero entregan `type` vacío para el resultado de
// `capture`. Sin esto, un JPEG real se rechazaba como "formato no
// soportado" y no había obturador al que volver (esta rama sólo existe
// cuando getUserMedia no está o fue denegado) — un callejón sin salida.
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export function inferMimeFromFileName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? (EXTENSION_TO_MIME[ext] ?? null) : null;
}

export type ManifestPhotoValidationResult =
  | { ok: true; file: File }
  | { ok: false; error: string };

const UNSUPPORTED_FORMAT_ERROR = 'Formato no soportado. Usa una foto JPEG, PNG, WEBP o HEIC.';
const TOO_LARGE_ERROR = 'La foto pesa demasiado (máx. 10MB). Repite con menos resolución.';

/**
 * Ronda 4 de review del PR #713 — algunos DocumentsProvider de Android
 * devuelven un nombre SIN extensión además de `type` vacío (`IMG_0042`).
 * `inferMimeFromFileName` no puede resolver eso, y rechazar es el mismo
 * callejón sin salida que M-B ya cerró para el caso con extensión: esta
 * función sólo se llama desde el fallback de `<input capture>`
 * (`ManifestCameraSheet.tsx`), que **únicamente** produce fotos de cámara
 * — asumir JPEG ahí es una apuesta razonable, no una validación genérica.
 *
 * Contrapartida documentada, no resuelta aquí (alcanzabilidad baja): un
 * `File` con `type` vacío, nombre `factura.jpg` y contenido real
 * `%PDF-1.7` se reetiqueta `image/jpeg` igual — Supabase Storage valida el
 * Content-Type declarado, no los bytes, así que no lo rechazará. Detectarlo
 * exigiría leer los primeros bytes del fichero (magic-byte sniffing), que
 * deliberadamente NO se implementa aquí.
 */
function resolveMimeForEmptyType(file: File): string {
  return inferMimeFromFileName(file.name) ?? 'image/jpeg';
}

/**
 * Valida tamaño y mime contra el bucket `manifests`. Un `file.type`
 * explícito nunca se sobrescribe — sólo se infiere cuando viene vacío
 * (M-B) — para que quien suba a Supabase Storage (fuera de esta fase) no
 * reciba un Content-Type vacío.
 */
export function validateManifestPhotoFile(file: File): ManifestPhotoValidationResult {
  const effectiveMime = file.type || resolveMimeForEmptyType(file);
  if (!MANIFEST_BUCKET_ALLOWED_MIME.includes(effectiveMime)) {
    return { ok: false, error: UNSUPPORTED_FORMAT_ERROR };
  }
  if (file.size > MANIFEST_BUCKET_MAX_BYTES) {
    return { ok: false, error: TOO_LARGE_ERROR };
  }
  return {
    ok: true,
    file: file.type ? file : new File([file], file.name, { type: effectiveMime }),
  };
}
