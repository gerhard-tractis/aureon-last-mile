'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!operatorId || !manifestId) {
      setCount(0);
      return;
    }
    // Seguimiento de spec-80 fase 6 (PR #736) — `5i` lleva "Sigue en PR-…"
    // al siguiente manifiesto de la misma ruta en el MISMO segmento de
    // Next, así que `manifestId` cambia sin remontar este hook. Sin esta
    // bandera, una lectura en vuelo del manifiesto VIEJO puede resolver
    // DESPUÉS de la del nuevo y pisar su count con el de la cola de otro
    // manifiesto — se autocorrige en el siguiente tick de `POLL_MS`, pero
    // mientras tanto la pantalla enseña un número que no es el suyo.
    let ignore = false;

    const read = async () => {
      try {
        const next = await queuedManifestPhotoCount(db, operatorId, manifestId);
        if (!ignore) setCount(next);
      } catch {
        // IndexedDB unavailable (private browsing, quota) — same posture
        // as useSyncQueue: never take the screen down over a read here.
      }
    };

    void read();
    const id = setInterval(() => void read(), POLL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [operatorId, manifestId]);

  return count;
}
