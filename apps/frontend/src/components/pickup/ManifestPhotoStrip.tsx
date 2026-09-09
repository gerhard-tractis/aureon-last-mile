'use client';

import { useRef } from 'react';
import { Camera, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useManifestDocuments,
  useUploadManifestDocument,
} from '@/hooks/pickup/useManifestDocuments';

interface ManifestPhotoStripProps {
  operatorId: string | null;
  manifestId: string | null;
  userId: string | null;
}

/**
 * spec-80 fase 3, mock `5f` — "FOTOS DEL MANIFIESTO FIRMADO". Un tile por
 * hoja ya capturada ("hoja N") más un tile "Agregar" con borde discontinuo,
 * literal del mock (docs/design/Recogida.dc.html, `5f`).
 *
 * La captura real con encuadre y revisión (`5g`/`5h`) es fase 4 — aquí
 * "Agregar" dispara directo un `<input type="file" capture>` (mismo patrón
 * que useCameraIntake.ts/CameraIntake.tsx), subiendo sin paso de revisión
 * intermedio. Fase 4 reemplaza este disparo por la hoja de cámara + revisión
 * sin tocar la subida en sí (useUploadManifestDocument).
 */
export function ManifestPhotoStrip({ operatorId, manifestId, userId }: ManifestPhotoStripProps) {
  const { data: documents = [], isFetching } = useManifestDocuments(operatorId, manifestId);
  const { mutateAsync, isPending } = useUploadManifestDocument();
  const inputRef = useRef<HTMLInputElement>(null);

  // Bloqueante 2, ronda 2 de review del PR #706 — MAX(sheet_number)+1, no
  // documents.length+1: con un hueco (una hoja borrada en el medio, cuando
  // exista borrado), length+1 puede reutilizar un número ya usado por una
  // fila viva y colisionar contra UNIQUE(manifest_id, sheet_number).
  const nextSheetNumber = documents.reduce((max, doc) => Math.max(max, doc.sheet_number), 0) + 1;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file || !operatorId || !manifestId || !userId) return;

    try {
      await mutateAsync({
        operatorId,
        manifestId,
        userId,
        sheetNumber: nextSheetNumber,
        file,
      });
    } catch (err) {
      // Bloqueante 1, ronda 2 de review del PR #706 — mismo criterio que F3
      // (ronda 2 de review del PR #679) sobre esta misma pantalla: nunca
      // pintar texto crudo de Postgres/red en una PWA en español. Mensaje
      // fijo y accionable en vez de err.message.
      console.error('Failed to upload manifest document:', err);
      toast.error('Esta foto no se guardó. Reintenta con señal.');
    }
  };

  const disabled = !operatorId || !manifestId || !userId;
  // Bloqueante 2, ronda 2 de review del PR #706 — `isPending` vuelve a
  // `false` en cuanto la mutación resuelve, un round-trip ANTES de que el
  // refetch de la lista (invalidateQueries en onSuccess) actualice
  // `documents`. Sin gatear también por `isFetching`, un segundo toque en
  // esa ventana recalcula el MISMO nextSheetNumber, el upload tiene éxito, y
  // el insert revienta con 23505 — huérfano permanente en el bucket.
  const addDisabled = disabled || isPending || isFetching;

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

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="manifest-photo-input"
        disabled={disabled}
        onChange={handleFileChange}
      />

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
          onClick={() => inputRef.current?.click()}
          disabled={addDisabled}
          className="aspect-[3/4] rounded-xl border-2 border-dashed border-accent/40 flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          ) : (
            <Plus className="h-5 w-5 text-accent" />
          )}
          <span className="text-xs font-semibold text-accent">Agregar</span>
        </button>
      </div>
    </div>
  );
}
