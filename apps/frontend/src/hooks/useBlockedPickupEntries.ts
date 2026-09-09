'use client';

import { useCallback, useEffect, useState } from 'react';
import { listDeadPickupEntries, type PickupQueueEntry } from '@/lib/db';

/**
 * spec-81 fase 4 — el detalle detrás del contador `blockedCount` de
 * `useSyncQueue`. Ese contador cuenta como bloqueado tanto un `dead` real
 * (rechazo de negocio, con `lastError`) como una entrada `pending` esperando
 * temporalmente detrás de otro operario — la segunda se libera sola y nunca
 * tuvo nada que explicar. Este hook expone SÓLO la primera: lo que un humano
 * puede necesitar resolver, no todo lo que el badge cuenta.
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
}

export function useBlockedPickupEntries(
  operatorId: string | null,
  blockedCount: number,
): UseBlockedPickupEntriesResult {
  const [entries, setEntries] = useState<PickupQueueEntry[]>([]);
  const [status, setStatus] = useState<BlockedPickupEntriesStatus>('idle');

  const read = useCallback(async () => {
    if (!operatorId || blockedCount === 0) {
      setEntries([]);
      setStatus('idle');
      return;
    }
    try {
      const rows = await listDeadPickupEntries(operatorId);
      setEntries(rows);
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, [operatorId, blockedCount]);

  useEffect(() => {
    void read();
  }, [read]);

  return { entries, status };
}
