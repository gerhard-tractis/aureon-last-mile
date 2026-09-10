'use client';

import { useState } from 'react';
import { Camera, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useManifestDocuments } from '@/hooks/pickup/useManifestDocuments';
import { ManifestCameraSheet } from './ManifestCameraSheet';
import { PhotoReviewSheet } from './PhotoReviewSheet';
import { db } from '@/lib/db';
import { enqueueManifestPhoto } from '@/lib/offline/photos';

interface ManifestPhotoStripProps {
  operatorId: string | null;
  manifestId: string | null;
  userId: string | null;
  /**
   * spec-80 fase 6 — el id humano/navegable de la carga
   * (`/app/pickup/complete/[loadId]`), no `manifestId` (un UUID). Se pasa
   * tal cual a `enqueueManifestPhoto` (ver el docstring de `externalLoadId`
   * en `PickupQueueEntry`, `@/lib/db`): sin él, el chip de sync no puede
   * decirle al operario qué carga abrir si una foto queda `dead`. También
   * es el `loadLabel` que muestran `5g`/`5h`.
   */
  externalLoadId?: string;
}

/**
 * spec-80 fase 3, mock `5f` — "FOTOS DEL MANIFIESTO FIRMADO". Un tile por
 * hoja ya capturada ("hoja N") más un tile "Agregar" con borde discontinuo,
 * literal del mock (docs/design/Recogida.dc.html, `5f`).
 *
 * spec-80 fase 6 — la captura pasa por `5g`/`5h` (`ManifestCameraSheet`/
 * `PhotoReviewSheet`, fase 4, mergeadas en #713) y el resultado se encola
 * con `enqueueManifestPhoto` (`lib/offline/photos.ts`, spec-81 fase 5,
 * mergeada) — NO con `useUploadManifestDocument` (la ruta online directa,
 * sin salida sin señal, que este componente usaba hasta esta fase). Un
 * `File` (lo único que producen `5g`/`5h`) ES un `Blob`: encaja en
 * `EnqueueManifestPhotoInput.blob` sin reconversión.
 *
 * `ManifestCameraSheet` se monta SIEMPRE (convención `open`/`onOpenChange`
 * del resto de `*Sheet.tsx`, ver su propio docstring, PR #713 M1/B2) — nunca
 * envuelta en `{cameraOpen && ...}`. `PhotoReviewSheet` no tiene esa
 * convención (exige un `photo: File` no nulo) y sí se monta
 * condicionalmente; como `onCapture` cierra la cámara antes de abrir la
 * revisión, las dos nunca están abiertas a la vez.
 *
 * `enqueueManifestPhoto` sólo escribe en IndexedDB (nunca red) — se llama
 * directo, no envuelto en una mutación de TanStack Query: no hay camino que
 * pueda quedar en pausa por `networkMode`, mismo patrón que
 * `useCloseManifest.ts` ya usa para su propio `enqueue` offline.
 */
export function ManifestPhotoStrip({ operatorId, manifestId, userId, externalLoadId }: ManifestPhotoStripProps) {
  const { data: documents = [], isFetching } = useManifestDocuments(operatorId, manifestId);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [reviewPhoto, setReviewPhoto] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Mismo criterio que antes de esta fase (ronda 2 de review del PR #706) —
  // MAX(sheet_number)+1, no documents.length+1: con un hueco (una hoja
  // borrada en el medio), length+1 puede reutilizar un número ya usado por
  // una fila viva y colisionar contra UNIQUE(manifest_id, sheet_number).
  // `enqueueManifestPhoto` además desambigua contra la cola LOCAL
  // (`nextAvailableSheetNumber`, ver su propio docstring) — este número es
  // sólo el punto de partida que ese desempate recibe.
  const nextSheetNumber = documents.reduce((max, doc) => Math.max(max, doc.sheet_number), 0) + 1;

  const disabled = !operatorId || !manifestId || !userId;
  const addDisabled = disabled || isFetching || isSaving;

  const handleUsePhoto = async (file: File) => {
    if (!operatorId || !manifestId || !userId) return;
    setIsSaving(true);
    try {
      await enqueueManifestPhoto(db, {
        operatorId,
        userId,
        manifestId,
        externalLoadId,
        sheetNumber: nextSheetNumber,
        blob: file,
      });
      setReviewPhoto(null);
      // Ronda 2 de review del PR #736 (M3, decisión del usuario) — sin
      // señal, la única evidencia de que la foto sobrevivió es esta
      // confirmación: `documents.length` (arriba) sólo cuenta lo que el
      // SERVIDOR ya confirmó, así que tras encolar sigue mostrando el mismo
      // número que antes de la captura — "0 fotos" tras la primera hoja, sin
      // ningún otro aviso. Mismo precedente que `useCloseManifest.ts`
      // (`toast.success` cuando el cierre queda encolado, no sólo cuando se
      // confirma online). Deliberadamente NO se cuenta la cola en la tira
      // (`manifest-photo-count`): eso exigiría leer `pickup_queue` desde este
      // componente y arriesgaría que ese contador y el del servidor
      // discreparan (mismo problema que costó una ronda en spec-81 fase 5) —
      // ver el spec.
      //
      // Ronda 3 de review del PR #736 — el usuario pidió primero que este
      // toast saliera SÓLO sin señal; lo retiró él mismo al ver que
      // `enqueueManifestPhoto` es hoy la ÚNICA ruta (ya no hay subida online
      // directa): el encolado ocurre siempre, así que "guardada" nunca
      // miente en ningún camino. Gatear el texto con `navigator.onLine`
      // habría sido dos redacciones que mantener sincronizadas y una rama
      // más que probar, por una diferencia que al operario no le importa —
      // ver el spec para el razonamiento completo. "Se sube al recuperar
      // señal" sí mentía con señal (el drenador la sube un segundo después,
      // no "al recuperar" nada) — de ahí la redacción sin promesa de espera.
      toast.success('Foto guardada. Se sube sola.');
    } catch (err) {
      // `enqueueManifestPhoto` lanza mensajes ya redactados en español y
      // accionables (tamaño máximo, cuota de fotos sin confirmar) — mismo
      // criterio que `useCloseManifest.ts` ya aplica a los errores de
      // `enqueue`: se muestran tal cual, no se sustituyen por un genérico.
      console.error('Failed to enqueue manifest photo:', err);
      toast.error(
        err instanceof Error ? err.message : 'Esta foto no se guardó. Reintenta con señal.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
          FOTOS DEL MANIFIESTO FIRMADO
        </span>
        <span
          data-testid="manifest-photo-count"
          className="ml-auto text-xs font-semibold text-status-success-text"
        >
          {documents.length}
        </span>
      </div>
      <p className="text-sm text-text-secondary">
        Fotografía el papel firmado por el local. Es el respaldo si después falta un paquete.
      </p>

      <div className="grid grid-cols-3 gap-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="aspect-[3/4] rounded-xl bg-surface-secondary border border-border flex flex-col items-center justify-center gap-1.5"
          >
            <Camera className="h-5 w-5 text-text-tertiary" />
            <span className="text-[11px] font-medium text-text-tertiary">hoja {doc.sheet_number}</span>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={addDisabled}
          className="aspect-[3/4] rounded-xl border-2 border-dashed border-accent/40 flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          ) : (
            <Plus className="h-5 w-5 text-accent" />
          )}
          <span className="text-xs font-semibold text-accent">Agregar</span>
        </button>
      </div>

      <ManifestCameraSheet
        open={cameraOpen}
        loadLabel={externalLoadId ?? manifestId ?? ''}
        sheetNumber={nextSheetNumber}
        capturedCount={documents.length}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => {
          setCameraOpen(false);
          setReviewPhoto(file);
        }}
        onDone={() => setCameraOpen(false)}
      />

      {reviewPhoto && (
        <PhotoReviewSheet
          loadLabel={externalLoadId ?? manifestId ?? ''}
          sheetNumber={nextSheetNumber}
          photo={reviewPhoto}
          onRetake={() => {
            setReviewPhoto(null);
            setCameraOpen(true);
          }}
          onUsePhoto={handleUsePhoto}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
