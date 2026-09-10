'use client';

import { useCallback, useEffect, useState } from 'react';
import { db, type PickupQueueEntry } from '@/lib/db';
import {
  countPendingInManifests,
  deadEntryBlocksManifestClose,
  listDeadPickupEntries,
} from '@/lib/offline/queue';

/**
 * spec-81 fase 4 — el detalle detrás del contador `blockedCount` de
 * `useSyncQueue`. Ese contador cuenta como bloqueado tanto un `dead` real
 * (rechazo de negocio, con `lastError`) como cualquier `pending` que
 * `manifestIsBlocked` no deja avanzar — y eso último tiene DOS causas
 * distintas, no una: una `pending` en el MISMO manifiesto que un `dead`
 * (bloqueada por esa misma carga, no se libera sola — ronda 2 de review del
 * PR #725, B1) y una `pending` fresca de OTRO operario por delante en el
 * FIFO de un manifiesto SIN ningún `dead` (esa sí se libera sola,
 * `CROSS_USER_RECLAIM_MS`). Mezclarlas —como hacía la primera versión de
 * este hook— le dice al operario "espera, se resuelve solo" sobre trabajo
 * que en realidad no va a salir hasta que él mismo resuelva el `dead` de
 * arriba.
 *
 * `status: 'error'` distingue "no hay nada bloqueado" de "no se pudo leer la
 * cola" (IndexedDB no disponible — modo privado, cuota agotada). `blockedCount`
 * viene de otra lectura (`useSyncQueue`) que puede seguir en pie diciendo que
 * SÍ hay algo bloqueado; un `entries: []` silencioso aquí pintaría un panel
 * vacío que contradice al badge, en vez de admitir que no se sabe.
 */

export type BlockedPickupEntriesStatus = 'idle' | 'ok' | 'error';

export interface UseBlockedPickupEntriesResult {
  entries: PickupQueueEntry[];
  status: BlockedPickupEntriesStatus;
  /** `pending` que comparten manifiesto con un `dead` ya listado en
   * `entries` — bloqueadas por ESA misma carga, no por otro operario. Se
   * resuelven cuando el `dead` de arriba se resuelva, nunca solas. */
  sameManifestBlockedCount: number;
  /** El resto de `blockedCount`, no explicado por ningún `dead` — una
   * `pending` detrás de otro operario en un manifiesto sin ningún `dead`.
   * Ésa sí se libera sola. */
  crossUserBlockedCount: number;
}

const EMPTY: UseBlockedPickupEntriesResult = {
  entries: [],
  status: 'idle',
  sameManifestBlockedCount: 0,
  crossUserBlockedCount: 0,
};

export function useBlockedPickupEntries(
  operatorId: string | null,
  blockedCount: number,
): UseBlockedPickupEntriesResult {
  const [result, setResult] = useState<UseBlockedPickupEntriesResult>(EMPTY);

  const read = useCallback(async () => {
    if (!operatorId || blockedCount === 0) {
      setResult(EMPTY);
      return;
    }
    try {
      const rows = await listDeadPickupEntries(db, operatorId);
      // Ronda 3 de review del PR #725 (B bloqueante) — el mismo seam que B1
      // cerró, invertido. `manifestHasDeadEntry`/`manifestIsBlocked`
      // (`queue-blocking.ts`) EXCLUYEN `manifest_photo` de "¿hay un dead
      // que bloquee este manifiesto?" (B-1, spec-81 fase 5). Derivar
      // `deadManifestIds` de TODOS los `dead`, fotos incluidas, contaba
      // como "bloqueadas por la misma carga" unas `pending` que
      // `getBlockedPickupCount` no cuenta como bloqueadas en absoluto —
      // van a drenar en el próximo sync, no están atascadas. Mismo
      // predicado (`deadEntryBlocksManifestClose`) en los dos sitios, para
      // que las dos mitades no puedan volver a separarse.
      const blockingRows = rows.filter((row) => deadEntryBlocksManifestClose(row.type));
      const deadManifestIds = Array.from(new Set(blockingRows.map((row) => row.manifestId)));
      const sameManifestBlockedCount = await countPendingInManifests(db, operatorId, deadManifestIds);
      const crossUserBlockedCount = Math.max(blockedCount - rows.length - sameManifestBlockedCount, 0);
      setResult({ entries: rows, status: 'ok', sameManifestBlockedCount, crossUserBlockedCount });
    } catch {
      setResult({ entries: [], status: 'error', sameManifestBlockedCount: 0, crossUserBlockedCount: 0 });
    }
  }, [operatorId, blockedCount]);

  useEffect(() => {
    void read();
  }, [read]);

  return result;
}
