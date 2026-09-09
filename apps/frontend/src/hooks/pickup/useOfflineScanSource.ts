'use client';

import { useCachedManifestSnapshot } from './useManifestDownload';
import type { ManifestCacheRecord } from '@/lib/offline/manifest-cache';

export interface OfflineScanSource {
  /** Offline, y todavía no se sabe si esta carga se descargó — la lectura
   * local (`manifest_cache`) sigue en curso. Nunca tratar como `blocked`. */
  unknown: boolean;
  /** Offline, resuelto, y esta carga NUNCA se descargó — `5d` no tiene de
   * dónde leer y debe negarse a entrar en vez de escanear contra datos que
   * no van a llegar. */
  blocked: boolean;
  /** El snapshot a usar en vez del fetch de red, cuando aplica.
   * `null` mientras `unknown` es verdadero o mientras hay señal — el
   * llamador nunca debe leer `snapshot` sin comprobar `unknown`/`blocked`
   * primero. */
  snapshot: ManifestCacheRecord | null;
}

/**
 * spec-82 fase 2 — decide si `5d` debe leer del caché offline en vez de la
 * red, y si debe bloquear la entrada del todo.
 *
 * En línea (`isOffline === false`) es inerte a propósito: no toca
 * IndexedDB, no bloquea nada — el flujo online de la pantalla sigue exactamente
 * como estaba.
 */
export function useOfflineScanSource(
  operatorId: string | null,
  externalLoadId: string | null,
  isOffline: boolean,
): OfflineScanSource {
  const { data } = useCachedManifestSnapshot(
    operatorId,
    isOffline ? externalLoadId : null,
  );

  if (!isOffline) {
    return { unknown: false, blocked: false, snapshot: null };
  }
  if (data === undefined) {
    return { unknown: true, blocked: false, snapshot: null };
  }
  if (data === null) {
    return { unknown: false, blocked: true, snapshot: null };
  }
  return { unknown: false, blocked: false, snapshot: data };
}
