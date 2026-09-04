'use client';

import { Camera } from 'lucide-react';
import { useBarcodeCameraScan } from '@/hooks/dispatch/mobile/useBarcodeCameraScan';

export interface DispatchRouteCameraViewfinderProps {
  active: boolean;
  onDecode: (code: string) => void;
}

/**
 * spec-76 2g — the camera fallback's viewfinder. Decision 4 / the mock
 * itself: the counter has to stay visible, so this never fills the
 * screen — it renders in the exact spot `ScanField` occupies in the 2e
 * layout, bounded to a fixed height, with the sticky header (route code,
 * counter) staying above it untouched. `useBarcodeCameraScan` only starts
 * the camera while `active` is true (rule 7): this component renders
 * nothing at all when inactive, so no stream exists to be idle.
 */
export function DispatchRouteCameraViewfinder({ active, onDecode }: DispatchRouteCameraViewfinderProps) {
  const { cameraError, readerElementId } = useBarcodeCameraScan({ active, onDecode });

  if (!active) return null;

  return (
    <div
      className="flex max-h-[220px] flex-col overflow-hidden rounded-[10px] border border-border bg-black/90"
      data-testid="dispatch-camera-viewfinder"
    >
      {cameraError ? (
        <div className="flex flex-col items-center gap-2 p-6 text-center text-white">
          <Camera className="h-8 w-8 opacity-60" aria-hidden="true" />
          <p className="text-[12.5px] opacity-80">
            No se pudo acceder a la cámara. Revisa el permiso de cámara del navegador, o vuelve al lector.
          </p>
        </div>
      ) : (
        <div id={readerElementId} className="mx-auto w-full max-h-[220px]" />
      )}
    </div>
  );
}
