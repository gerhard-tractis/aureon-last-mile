'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera as CameraIcon } from 'lucide-react';

// Debe seguir exactamente a la definición del bucket privado `manifests`
// (packages/database/supabase/migrations/20260430000001_create_manifests_storage_bucket.sql,
// `file_size_limit`/`allowed_mime_types`) — si diverge, el rechazo pasa de
// "aquí, con el operario delante" a "horas después, drenando la cola de
// spec-81, sin nadie para repetir la foto".
const MANIFEST_BUCKET_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
const MANIFEST_BUCKET_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

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
  /**
   * Ronda 2 de review del PR #713 (M1) — la convención local de
   * `components/pickup/*Sheet.tsx` es Radix `open`/`onOpenChange`, montado
   * siempre. Esta pantalla NO sigue esa convención por defecto: pide la
   * cámara en el efecto de montaje y la libera en el de desmontaje, así que
   * "renderizar condicionalmente" (dejar de montarla) es la forma esperada
   * de cerrarla. `open` existe para quien SÍ quiera montarla siempre:
   * en `false` libera el stream sin desmontar; en `true` (o al montar) lo
   * vuelve a pedir. Por defecto `true` — mantiene el contrato de "quien la
   * monta, la cierra desmontándola".
   *
   * `5g` y `5h` nunca deben estar abiertas/montadas a la vez — ambas son
   * `fixed inset-0 z-50`, y quien las cablee (fuera de esta fase, ver el
   * spec) es responsable de esa exclusión mutua.
   */
  open?: boolean;
}

/**
 * spec-80 fase 4, mock `5g` — "cámara para el manifiesto firmado".
 *
 * El mock pide `expo-camera` (app Expo dormida, `apps/mobile`); esta es la
 * PWA. El respaldo con `<input type="file" capture="environment">` sigue el
 * patrón ya probado de `useCameraIntake.ts`/`CameraIntake.tsx` para este
 * mismo bucket — pero el encuadre en vivo con `getUserMedia` **no tiene
 * precedente en este repo**: ningún hook ni componente existente lo usa.
 * Ronda 2 de review del PR #713 — el comentario anterior afirmaba lo
 * contrario; verificado que no es así.
 *
 * No sube nada: `onCapture` entrega el frame como `File` a quien la monte
 * (5h, la revisión), que decide si sube de inmediato o encola sin red. Ese
 * cableado a `ManifestPhotoStrip`/`useUploadManifestDocument` queda fuera de
 * esta fase — ver el spec.
 *
 * M4, ronda 2 de review del PR #713 (seguimiento, no bloqueante) — sin
 * trampa de foco, sin manejo de `Escape`/atrás de Android. Anotado en el
 * spec; no se implementa aquí.
 */
export function ManifestCameraSheet({
  loadLabel,
  sheetNumber,
  capturedCount,
  onClose,
  onCapture,
  onDone,
  open = true,
}: ManifestCameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [useFallbackInput, setUseFallbackInput] = useState(false);
  // Bloqueante 1, ronda 2 de review del PR #713 — el obturador NO puede
  // habilitarse hasta que el <video> reporte frames reales
  // (`loadedmetadata`, videoWidth/videoHeight > 0). Antes de esto estaba
  // habilitado desde el primer render, durante todo el diálogo de permiso
  // del sistema: un toque ahí capturaba un canvas 1080×1440 sin señal —
  // negro sólido, ~1.5MB, un File "válido" que es la evidencia de custodia
  // (spec-80) sin ninguna información real.
  const [videoReady, setVideoReady] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setVideoReady(false);
      return;
    }

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
      setVideoReady(false);
    };
  }, [open]);

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // Comprobación defensiva además del gate del botón (`disabled`
    // más abajo): si el track termina entre que el botón se habilitó y el
    // toque llega, `videoWidth` vuelve a 0 y NO hay que inventarse un
    // tamaño por defecto — eso es exactamente lo que producía la foto negra.
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // Menor, ronda 2 de review del PR #713 — el tipo del File viene del
        // Blob que realmente produjo `toBlob`, no de un literal hardcodeado:
        // si el mime real cambiara, el File no debe mentir sobre su
        // contenido en el Content-Type que ve Supabase Storage.
        onCapture(new File([blob], `sheet-${sheetNumber}-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }));
      },
      'image/jpeg',
      0.9
    );
  }, [onCapture, sheetNumber]);

  const handleFallbackFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fallbackInputRef.current) fallbackInputRef.current.value = '';
    if (!file) return;

    // M3, ronda 2 de review del PR #713 — el camino getUserMedia siempre
    // produce JPEG bajo el límite; el fallback pasa un File crudo de la
    // cámara nativa, que hoy en un teléfono moderno ronda 4-8MB y puede
    // superar los 10MiB del bucket con facilidad. Rechazar aquí, con el
    // operario delante y la hoja todavía en la mano, no tras drenar la cola
    // de spec-81 horas después sin nadie para repetir la foto.
    if (!MANIFEST_BUCKET_ALLOWED_MIME.includes(file.type)) {
      setFallbackError('Formato no soportado. Usa una foto JPEG, PNG, WEBP o HEIC.');
      return;
    }
    if (file.size > MANIFEST_BUCKET_MAX_BYTES) {
      setFallbackError('La foto pesa demasiado (máx. 10MB). Repite con menos resolución.');
      return;
    }

    setFallbackError(null);
    onCapture(file);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Hoja ${sheetNumber} de ${loadLabel}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0908] text-[#f5ecd7]"
    >
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
            {fallbackError && (
              <span className="absolute left-0 right-0 bottom-[26px] text-center text-[13px] font-medium text-red-400 px-4">
                {fallbackError}
              </span>
            )}
          </>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            data-testid="manifest-camera-video"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setVideoReady(v.videoWidth > 0 && v.videoHeight > 0);
            }}
            className="h-full w-full object-cover"
          />
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
            disabled={useFallbackInput || !videoReady}
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
