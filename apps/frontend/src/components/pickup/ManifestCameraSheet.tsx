'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Zap, Camera as CameraIcon } from 'lucide-react';

interface ManifestCameraSheetProps {
  /** "CARGA-99814" — used in the header and (via fallback input) the file name. */
  loadLabel: string;
  /** Hoja N — the sheet about to be captured, 1-indexed. */
  sheetNumber: number;
  /** "YA CAPTURADAS · N" — hojas ya subidas o pendientes de revisión en esta sesión. */
  capturedCount: number;
  onClose: () => void;
  /** Fires once per capture with the frame as a File — the caller (5h) decides what happens next. */
  onCapture: (file: File) => void;
  onDone: () => void;
}

/**
 * spec-80 fase 4, mock `5g` — "cámara para el manifiesto firmado".
 *
 * El mock pide `expo-camera` (app Expo dormida, `apps/mobile`); esta es la
 * PWA, así que la captura va con `getUserMedia` con una previsualización en
 * vivo y, si el navegador no lo soporta o el permiso se rechaza, con
 * `<input type="file" capture="environment">` — el mismo patrón que ya usa
 * `useCameraIntake.ts`/`CameraIntake.tsx` para este mismo bucket.
 *
 * No sube nada: `onCapture` entrega el frame como `File` a quien la monte
 * (5h, la revisión), que decide si sube de inmediato o encola sin red. Ese
 * cableado a `ManifestPhotoStrip`/`useUploadManifestDocument` queda fuera de
 * esta fase — ver el spec.
 */
export function ManifestCameraSheet({
  loadLabel,
  sheetNumber,
  capturedCount,
  onClose,
  onCapture,
  onDone,
}: ManifestCameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [useFallbackInput, setUseFallbackInput] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

    if (!mediaDevices?.getUserMedia) {
      setUseFallbackInput(true);
      return;
    }

    mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        // Permiso denegado, sin cámara, o navegador sin soporte real detrás
        // de un getUserMedia que sí existe (algunos WebViews) — el
        // respaldo fotográfico no puede depender de que eso funcione.
        if (!cancelled) setUseFallbackInput(true);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1440;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `sheet-${sheetNumber}-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9
    );
  }, [onCapture, sheetNumber]);

  const handleFallbackFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fallbackInputRef.current) fallbackInputRef.current.value = '';
    if (file) onCapture(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0908] text-[#f5ecd7]">
      <div className="flex-none flex items-center gap-3 h-14 px-4">
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="grid place-items-center w-11 h-11 rounded-xl bg-white/10"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold">
            Hoja {sheetNumber} de {loadLabel}
          </span>
          <span className="text-xs font-medium text-[#9a8e7d]">Manifiesto firmado</span>
        </div>
        <span
          aria-hidden="true"
          className="ml-auto grid place-items-center w-11 h-11 rounded-xl bg-white/10 text-[#e6c15c]"
        >
          <Zap className="h-[18px] w-[18px]" />
        </span>
      </div>

      <div className="flex-1 min-h-0 relative bg-[#15130f] grid place-items-center overflow-hidden">
        {useFallbackInput ? (
          <>
            <CameraIcon className="h-8 w-8 text-[#4a443c]" />
            <input
              ref={fallbackInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
              data-testid="manifest-camera-fallback-input"
              onChange={handleFallbackFileChange}
            />
          </>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" data-testid="manifest-camera-canvas" />

        <span className="absolute left-[26px] top-[74px] w-[38px] h-[38px] border-l-[3px] border-t-[3px] border-[#e6c15c] rounded-tl-md" />
        <span className="absolute right-[26px] top-[74px] w-[38px] h-[38px] border-r-[3px] border-t-[3px] border-[#e6c15c] rounded-tr-md" />
        <span className="absolute left-[26px] bottom-[74px] w-[38px] h-[38px] border-l-[3px] border-b-[3px] border-[#e6c15c] rounded-bl-md" />
        <span className="absolute right-[26px] bottom-[74px] w-[38px] h-[38px] border-r-[3px] border-b-[3px] border-[#e6c15c] rounded-br-md" />

        <span className="absolute left-0 right-0 bottom-[26px] text-center text-[13.5px] font-medium leading-snug text-[#e8d9bd]">
          Encuadra la hoja completa, con la firma visible
        </span>
      </div>

      <div className="flex-none flex flex-col gap-3.5 px-5 pt-4 pb-7">
        <span className="text-[11.5px] font-semibold tracking-[.1em] text-[#9a8e7d]">
          YA CAPTURADAS · {capturedCount}
        </span>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3.5">
          <div className="flex gap-2 justify-self-start" />
          <button
            type="button"
            aria-label="Capturar foto"
            onClick={handleShutter}
            disabled={useFallbackInput}
            className="justify-self-center w-[72px] h-[72px] rounded-full bg-[#e6c15c] border-4 border-[#0a0908] ring-[3px] ring-[#e6c15c] grid place-items-center disabled:opacity-40"
          >
            <CameraIcon className="h-7 w-7 text-[#13110d]" />
          </button>
          <button
            type="button"
            onClick={onDone}
            className="justify-self-end text-sm font-semibold border border-[#2a2218] rounded-xl min-h-12 px-4"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
