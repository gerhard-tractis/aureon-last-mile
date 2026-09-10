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
  /**
   * M1, revisión de fase 2 — la lectura local de IndexedDB FALLÓ (modo
   * privado, un `upgrade` bloqueado por otra pestaña, cuota agotada), no
   * "todavía no sabemos". Antes de esto, un fallo de lectura quedaba
   * indistinguible de `unknown` para siempre: `data` nunca deja de ser
   * `undefined`, así que la pantalla se congelaba en un spinner sin texto,
   * sin botón, sin salida, y el chip `DESCARGAR` nunca aparecía sin decir
   * por qué. `error` y `unknown` son mutuamente excluyentes.
   */
  error: boolean;
  /** Reintenta la lectura local. No-op cuando no aplica — seguro de llamar
   * siempre, sin que el llamador tenga que comprobar `error` primero. */
  retry: () => void;
  /** El snapshot a usar en vez del fetch de red, cuando aplica.
   * `null` mientras `unknown`/`error`/`blocked` son verdaderos o mientras
   * hay señal — el llamador nunca debe leer `snapshot` sin comprobar los
   * otros campos primero. */
  snapshot: ManifestCacheRecord | null;
}

const NOOP = () => {};

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
  const { data, isError, refetch } = useCachedManifestSnapshot(
    operatorId,
    isOffline ? externalLoadId : null,
  );
  const retry = () => void refetch();

  if (!isOffline) {
    return { unknown: false, blocked: false, error: false, retry: NOOP, snapshot: null };
  }
  if (isError) {
    return { unknown: false, blocked: false, error: true, retry, snapshot: null };
  }
  if (data === undefined) {
    return { unknown: true, blocked: false, error: false, retry: NOOP, snapshot: null };
  }
  if (data === null) {
    return { unknown: false, blocked: true, error: false, retry: NOOP, snapshot: null };
  }
  return { unknown: false, blocked: false, error: false, retry: NOOP, snapshot: data };
}
