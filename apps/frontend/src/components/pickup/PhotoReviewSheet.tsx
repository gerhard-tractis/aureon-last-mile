'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

interface PhotoReviewSheetProps {
  /** "CARGA-99814" */
  loadLabel: string;
  /** Hoja N que se acaba de capturar. */
  sheetNumber: number;
  /**
   * M2, ronda 2 de review del PR #713 — estrechado a `File`: es lo único
   * que produce `ManifestCameraSheet` (canvas y fallback por igual).
   * `useUploadManifestDocument` exige `File`, y `File | Blob` no compilaba
   * en el punto de inserción real. La rama offline de spec-81 encaja igual
   * (`File extends Blob`).
   */
  photo: File;
  onRetake: () => void;
  /** El caller decide qué hacer con la foto (subir de inmediato, o encolar sin red). */
  onUsePhoto: (photo: File) => void;
  /**
   * Deshabilita ambas acciones mientras el caller procesa `onUsePhoto`
   * (p.ej. una subida en curso). Opcional: el guardado puede ser
   * instantáneo (encolar) o diferido — ver el spec.
   */
  isSaving?: boolean;
}

/**
 * spec-80 fase 4, mock `5h` — "revisión de la foto antes de guardarla".
 *
 * Puramente presentacional: no sube nada ni decide el destino de la foto.
 * `onUsePhoto` recibe el mismo `File` capturado por `5g` y es quien la monta
 * (fuera de esta fase) quien decide si sube de inmediato o la encola sin
 * red — ver "diseña asumiendo que la subida puede diferirse" en el spec.
 *
 * M4, ronda 2 de review del PR #713 (seguimiento, no bloqueante) — sin
 * `role="dialog"`, sin trampa de foco, sin manejo de `Escape`/atrás de
 * Android. Anotado en el spec; no se implementa aquí.
 */
export function PhotoReviewSheet({
  loadLabel,
  sheetNumber,
  photo,
  onRetake,
  onUsePhoto,
  isSaving = false,
}: PhotoReviewSheetProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Revisar hoja ${sheetNumber}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0908] text-[#f5ecd7]"
    >
      <div className="flex-none flex items-center gap-3 h-14 px-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold">Revisar hoja {sheetNumber}</span>
          <span className="text-xs font-medium text-[#9a8e7d]">{loadLabel}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 mx-5 rounded-2xl bg-[#15130f] border border-[#2a2218] grid place-items-center overflow-hidden relative">
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- blob: preview URL, next/image cannot optimize it
          <img
            src={previewUrl}
            alt={`Foto capturada, hoja ${sheetNumber}`}
            data-testid="photo-review-preview"
            className="h-full w-full object-contain"
          />
        )}
      </div>

      <div className="flex-none flex items-center gap-2.5 mx-5 mt-4 p-3.5 rounded-xl bg-amber-900/30 border border-amber-800">
        <AlertTriangle className="h-[18px] w-[18px] flex-none text-amber-400" />
        <span className="text-[13.5px] leading-snug text-amber-400">
          ¿Se lee la firma? Una foto borrosa no sirve como respaldo.
        </span>
      </div>

      <div className="flex-none flex gap-2.5 px-5 pt-4 pb-7">
        <button
          type="button"
          onClick={onRetake}
          disabled={isSaving}
          className="flex-1 text-center text-[15px] font-semibold border border-[#2a2218] rounded-xl min-h-14 disabled:opacity-50"
        >
          Repetir
        </button>
        <button
          type="button"
          onClick={() => onUsePhoto(photo)}
          disabled={isSaving}
          className="flex-1 flex items-center justify-center gap-2 min-h-14 rounded-xl bg-[#e6c15c] text-[#13110d] text-[15px] font-semibold disabled:opacity-50"
        >
          <Check className="h-[19px] w-[19px]" strokeWidth={2.8} />
          Usar foto
        </button>
      </div>
    </div>
  );
}
