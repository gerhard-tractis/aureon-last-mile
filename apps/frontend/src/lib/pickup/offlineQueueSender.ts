import type { SupabaseClient } from '@supabase/supabase-js';
import type { PickupQueueEntry } from '@/lib/db';
import type { OfflineQueueOutcome, OfflineQueueSender } from '@/hooks/useOfflineQueue';
import { classifyCloseManifestError } from '@/lib/pickup/closeManifestErrors';

/**
 * spec-81 fase 2, B2 (ronda 1 de review del PR #679) — el `OfflineQueueSender`
 * real, contra Supabase, que `useOfflineQueue` necesita para dejar de ser un
 * drenador sin nadie que lo llame. Se monta una única vez en `AppLayout`
 * (ver ese fichero) con el cliente Supabase del navegador.
 *
 * Sólo sabe enviar `close_manifest` — el único tipo que algún productor de
 * producción encola hoy (`complete/[loadId]/page.tsx`). `pickup_scan` no
 * tiene todavía ningún productor (el escritor de escaneos offline queda
 * diferido, coordinación con fase 3 documentada en `useOfflineQueue.ts`);
 * si alguna vez aparece uno antes de que este sender lo sepa enviar, la
 * entrada reintenta con retroceso en vez de tirar el drenador entero.
 */
/**
 * B4, ronda 1 de review del PR #679 — `postgrest-js` no fija ningún timeout
 * propio; sin `abortSignal`, `close_manifest` corre contra el timeout por
 * defecto del `fetch` del navegador (~300s), muy por encima de lo que
 * `RECLAIM_STALE_MS` (`useOfflineQueue.ts`) puede esperar antes de reclamar
 * la entrada como huérfana y reenviarla — el envío duplicado que ese umbral
 * existe para evitar. Imponer el timeout aquí, en el sender, hace que el
 * contrato "RECLAIM_STALE_MS > timeout_http de la petición" se cumpla por
 * construcción, en vez de depender de un valor por defecto de la plataforma
 * que ni está documentado como estable ni este código controla.
 *
 * 60s: más que suficiente para dos firmas base64 (~150 KB) en 2G/EDGE (el
 * escenario de mayor riesgo declarado en el spec), y aun así muy por debajo
 * de `RECLAIM_STALE_MS`.
 */
const CLOSE_MANIFEST_TIMEOUT_MS = 60_000;

export function createPickupQueueSender(supabase: SupabaseClient): OfflineQueueSender {
  return async (entry: PickupQueueEntry): Promise<OfflineQueueOutcome> => {
    if (entry.type !== 'close_manifest') {
      return {
        outcome: 'retry',
        reason: `no sender implemented for offline queue entry type "${entry.type}"`,
      };
    }
    return sendCloseManifest(supabase, entry);
  };
}

async function sendCloseManifest(
  supabase: SupabaseClient,
  entry: PickupQueueEntry,
): Promise<OfflineQueueOutcome> {
  const payload = entry.payload as {
    manifestId: string;
    signatures: {
      operator_signature: string | null;
      client_signature: string | null;
      client_name: string | null;
    };
  };

  const { error } = await supabase
    .rpc('close_manifest', {
      p_manifest_id: payload.manifestId,
      p_signatures: payload.signatures,
    })
    .abortSignal(AbortSignal.timeout(CLOSE_MANIFEST_TIMEOUT_MS));

  if (!error) {
    return { outcome: 'sent' };
  }

  const classified = classifyCloseManifestError(error);
  if (classified.kind === 'offline') {
    return { outcome: 'retry', reason: classified.message };
  }
  return { outcome: 'dead', reason: classified.message };
}
