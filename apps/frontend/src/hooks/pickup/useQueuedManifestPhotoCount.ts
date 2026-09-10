'use client';

import { useCallback, useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { queuedManifestPhotoCount } from '@/lib/offline/photos';

/** Same cadence as `useSyncQueue`'s poll — the queue only changes via a
 * drain or a new capture, both of which happen while this screen is open. */
const POLL_MS = 2_000;

/**
 * Ronda 4 de review del PR #736 (bloqueante 2) — cuántas fotos de este
 * manifiesto siguen en `pickup_queue` sin confirmar (`pending`/`sending`).
 * `complete/[loadId]/page.tsx` la suma a `documents.length` (lo confirmado
 * por el servidor) para que "Respaldo: N fotos" en `5i` cuente también lo
 * que se acaba de capturar y todavía no llegó — ver `queuedManifestPhotoCount`
 * (`lib/offline/photos.ts`) para el porqué de qué estados cuentan.
 */
export function useQueuedManifestPhotoCount(
  operatorId: string | null,
  manifestId: string | null,
): number {
  const [count, setCount] = useState(0);

  const read = useCallback(async () => {
    if (!operatorId || !manifestId) {
      setCount(0);
      return;
    }
    try {
      setCount(await queuedManifestPhotoCount(db, operatorId, manifestId));
    } catch {
      // IndexedDB unavailable (private browsing, quota) — same posture as
      // useSyncQueue: never take the screen down over a read here.
    }
  }, [operatorId, manifestId]);

  useEffect(() => {
    void read();
    if (!operatorId || !manifestId) return;
    const id = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(id);
  }, [read, operatorId, manifestId]);

  return count;
}
