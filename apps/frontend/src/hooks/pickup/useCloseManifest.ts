import { useState } from 'react';
import { toast } from 'sonner';
import { createSPAClient } from '@/lib/supabase/client';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/offline/queue';
import { PICKUP_QUEUE_WAKE_EVENT } from '@/hooks/useOfflineQueue';
import { classifyCloseManifestError } from '@/lib/pickup/closeManifestErrors';

export interface UseCloseManifestParams {
  manifestId: string | null;
  operatorId: string | null;
  userId: string | null;
  operatorSignature: string | null;
  clientSignature: string | null;
  clientName: string;
  /** Called on every path that ends in a closed (or queued-to-close)
   *  manifest: online success, idempotent 23505 recovery, and offline
   *  enqueue. Page-level concern (what to show next) — this hook only
   *  decides whether the close happened, not what the screen does about it. */
  onClosed: () => void;
}

export interface UseCloseManifestResult {
  isSubmitting: boolean;
  handleComplete: () => Promise<void>;
}

/**
 * Ronda 2 de review del PR #726 — extracted verbatim from
 * `complete/[loadId]/page.tsx` (`5f`) to keep that file under the repo's
 * file-size convention. This is ~113 lines of pure logic (no JSX) carrying
 * six rounds of review comments (PR #679) about exactly why each branch
 * exists — moved as-is, not rewritten, so none of that history is lost or
 * silently reinterpreted.
 */
export function useCloseManifest({
  manifestId,
  operatorId,
  userId,
  operatorSignature,
  clientSignature,
  clientName,
  onClosed,
}: UseCloseManifestParams): UseCloseManifestResult {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleComplete = async () => {
    if (!manifestId || !operatorId || !userId || !operatorSignature) return;
    setIsSubmitting(true);

    try {
      const supabase = createSPAClient();
      // H5 (fix round 1): operator_name is NOT sent — close_manifest derives
      // the signer's name server-side from the JWT actor's public.users row.
      // A client-supplied name would be worthless as custody-transfer
      // evidence.
      const { error } = await supabase.rpc('close_manifest', {
        p_manifest_id: manifestId,
        p_signatures: {
          operator_signature: operatorSignature,
          client_signature: clientSignature,
          client_name: clientName || null,
        },
      });

      if (error) throw error;
      toast.success('Manifiesto completado exitosamente');
      // 5i — spec-80 fase 5: stay on this route and show the closed
      // summary instead of leaving immediately. "Volver a mis recogidas"
      // (the summary's own CTA) is what now navigates to `/app/pickup/
      // route/active` (5c) — see the render branch in the page.
      onClosed();
    } catch (err) {
      // H2 (fix round 1): close_manifest now has three hard rejections
      // (cross-tenant, non-closable status, already signed) where the old
      // raw .update() almost always just succeeded. Swallowing the error
      // left the operator staring at a re-enabled button with no idea
      // whether the signature was captured — surface it.
      // F3 (fix round 2): close_manifest raises in English with a sentinel
      // prefix (MANIFEST_ALREADY_SIGNED, MANIFEST_NOT_CLOSABLE,
      // OPERATOR_SIGNATURE_REQUIRED) — map it to Spanish rather than
      // painting raw Postgres text on an all-Spanish PWA.
      console.error('Failed to complete manifest:', err);

      // spec-81 fase 2, checklist item 5 — "sin conexión" y "rechazo de
      // negocio irrecuperable" son ramas distintas, no el mismo mensaje ni
      // la misma afordancia. Offline: encolar la firma capturada y dejar al
      // operario seguir — es el caso normal en este muelle, y
      // `useOfflineQueue` la drenará al volver la señal. Rechazo de
      // negocio: detenerse, no encolar algo que el servidor puede seguir
      // rechazando para siempre, y re-habilitar el botón para que el
      // operario corrija o pida ayuda.
      const classified = classifyCloseManifestError(err);

      // P0, ronda 3 de review del PR #679 (bloqueante) — `idempotent` (23505
      // `MANIFEST_ALREADY_SIGNED`) significa que el cierre YA SE APLICÓ: la
      // respuesta se perdió en el camino (túnel, o el propio
      // `AbortSignal.timeout` del sender), no que el intento fallara. Sin
      // esta rama caía al `toast.error` genérico de abajo, dejando al
      // operario atrapado en esta pantalla para siempre después de un cierre
      // que sí funcionó — refrescar no ayuda, el `useEffect` recarga el
      // mismo manifiesto ya firmado. `offlineQueueSender.ts` ya trata este
      // mismo `kind` como éxito para el drenador de fondo; esto alinea el
      // camino interactivo con esa misma lectura.
      if (classified.kind === 'idempotent') {
        toast.success(classified.message);
        onClosed();
        return;
      }

      if (classified.kind === 'offline') {
        // M5, ronda 2 de review del PR #679 (mayor): `enqueue` puede lanzar
        // por su cuenta — el tope de 500 entradas sin confirmar
        // (`lib/offline/queue.ts`), o cualquier `DOMException` real de
        // IndexedDB (cuota agotada, modo privado de Safari). Antes, esa
        // excepción escapaba de este `catch` sin capturar: `setIsSubmitting
        // (false)` nunca corría, el botón quedaba deshabilitado con
        // "Completando…" para siempre, sin toast, y la firma se perdía.
        // "fallo silencioso contra la cuota" se convertía en "fallo
        // silencioso con la pantalla colgada".
        try {
          await enqueue(db, {
            operatorId,
            userId,
            manifestId,
            type: 'close_manifest',
            payload: {
              manifestId,
              signatures: {
                operator_signature: operatorSignature,
                client_signature: clientSignature,
                client_name: clientName || null,
              },
            },
          });
          // Nota menor, ronda 6 de review del PR #679 — sin esto, la entrada
          // recién encolada esperaba al próximo `online` real (o a un timer
          // de backoff de OTRA entrada) para intentarse por primera vez. El
          // drenador ya está montado globalmente en `AppLayout`; este evento
          // es la misma señal que `retryBlockedManifest` ya usa para
          // despertarlo sin fingir una reconexión que no ocurrió.
          window.dispatchEvent(new Event(PICKUP_QUEUE_WAKE_EVENT));
          toast.success(classified.message);
          onClosed();
          return;
        } catch (enqueueErr) {
          console.error('Failed to enqueue offline close_manifest:', enqueueErr);
          toast.error(
            enqueueErr instanceof Error ? enqueueErr.message : 'No se pudo completar el manifiesto',
          );
          setIsSubmitting(false);
          return;
        }
      }

      toast.error(classified.message);
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, handleComplete };
}
