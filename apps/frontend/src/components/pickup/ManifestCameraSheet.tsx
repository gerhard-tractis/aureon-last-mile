'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera as CameraIcon, Zap } from 'lucide-react';
import { validateManifestPhotoFile } from '@/lib/pickup/manifestPhotoValidation';
import { isVideoReady } from '@/lib/pickup/cameraReadiness';
import { useTorch } from '@/hooks/pickup/useTorch';

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
   * PR #713, M1/B2 — convención Radix `open`/`onOpenChange`: montar
   * siempre. En `false` libera el stream y no renderiza nada. `5g`/`5h`
   * nunca abiertas a la vez — exclusión a cargo de quien las cablee.
   */
  open?: boolean;
}

/**
 * spec-80 fase 4, mock `5g` — "cámara para el manifiesto firmado". El mock
 * pide `expo-camera` (app Expo dormida); esta es la PWA — respaldo con
 * `<input type="file" capture="environment">` (patrón de `useCameraIntake.ts`).
 * No sube nada: `onCapture` entrega el `File` a quien monte esto (5h), que
 * decide subir de inmediato o encolar sin red.
 *
 * M4 — `role="dialog"`/`aria-modal` sí están; trampa de foco y
 * `Escape`/atrás de Android, sin implementar.
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
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [useFallbackInput, setUseFallbackInput] = useState(false);
  // B1 — el obturador NO se habilita hasta `isVideoReady` (antes: foto negra "válida" desde el primer render).
  const [videoReady, setVideoReady] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  // Fase 9, spec-95, `5g` — flash; estado en `useTorch` (review 6817496).
  const { torchSupported, torchOn, registerTrack, handleTrackDown, handleTrackEnded, toggleTorch, reset: resetTorch } = useTorch();

  useEffect(() => {
    // Ronda 3 — parar tracks aquí era código muerto: la limpieza del
    // efecto ANTERIOR ya lo hace. Sólo hace falta no pedir cámara.
    if (!open) return;

    let cancelled = false;
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

    if (!mediaDevices?.getUserMedia) {
      setUseFallbackInput(true);
      return;
    }

    // M-A — la pista muerta a mitad de sesión no pone las dimensiones del
    // <video> a 0 (queda congelada); escuchar la pista sí lo detecta.
    // Bloqueante ronda 4 — `visible`/`unmute` son el contrario obligado de
    // `hidden`/`mute`, o el obturador queda muerto tras volver de fondo.
    const handleVisibilityChange = () => {
      setVideoReady(
        document.visibilityState === 'hidden' ? false : isVideoReady(videoRef.current, trackRef.current)
      );
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const trackCleanupFns: Array<() => void> = [];

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

        const handleVideoDown = () => setVideoReady(false);
        const handleVideoUp = () => setVideoReady(isVideoReady(videoRef.current, trackRef.current));
        // M1 — `mute` es reversible (flash off, capacidad intacta);
        // `ended` es definitivo (flash off Y sin botón).
        const handleEnded = () => {
          handleVideoDown();
          handleTrackEnded();
        };
        const handleMute = () => {
          handleVideoDown();
          handleTrackDown();
        };
        stream.getVideoTracks().forEach((track) => {
          trackRef.current = track;
          track.addEventListener('ended', handleEnded);
          track.addEventListener('mute', handleMute);
          track.addEventListener('unmute', handleVideoUp);
          trackCleanupFns.push(() => {
            track.removeEventListener('ended', handleEnded);
            track.removeEventListener('mute', handleMute);
            track.removeEventListener('unmute', handleVideoUp);
          });

          registerTrack(track);
        });
      })
      .catch(() => {
        // Permiso denegado, sin cámara, o navegador sin soporte real detrás
        // de un getUserMedia que sí existe (algunos WebViews) — el
        // respaldo fotográfico no puede depender de que eso funcione.
        if (!cancelled) setUseFallbackInput(true);
      });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      trackCleanupFns.forEach((cleanup) => cleanup());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      trackRef.current = null;
      setVideoReady(false);
      resetTorch();
    };
  }, [open, resetTorch, registerTrack, handleTrackDown, handleTrackEnded]);

  // El track REAL de `trackRef`; el resto vive en `useTorch`.
  const handleToggleTorch = useCallback(() => {
    toggleTorch(trackRef.current);
  }, [toggleTorch]);

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // Defensa en profundidad (no el detector principal, ver M-A): sin
    // tamaño por defecto si las dimensiones son 0 — eso daba la foto negra.
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // Tipo real del Blob, no un literal — no mentir el Content-Type a Storage.
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

    // M3/M-B — el fallback puede superar los 10MiB del bucket o venir con
    // `type` vacío (Android). Validar aquí, con el operario delante.
    const result = validateManifestPhotoFile(file);
    if (!result.ok) {
      setFallbackError(result.error);
      return;
    }

    setFallbackError(null);
    onCapture(result.file);
  };

  // B2 — sin esto quedaba un overlay negro tapando la PWA. Va DESPUÉS de
  // todos los hooks — antes rompería las reglas de hooks de React.
  if (!open) return null;

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
        {/* `5g`: arriba a la derecha, ámbar — sólo si `torchSupported`. */}
        {torchSupported && (
          <button
            type="button"
            aria-label="Flash"
            aria-pressed={torchOn}
            onClick={handleToggleTorch}
            className="ml-auto grid place-items-center w-11 h-11 rounded-xl bg-white/10"
          >
            <Zap className="h-[18px] w-[18px] text-[#e6c15c]" fill={torchOn ? 'currentColor' : 'none'} />
          </button>
        )}
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
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              data-testid="manifest-camera-video"
              onLoadedMetadata={() => setVideoReady(isVideoReady(videoRef.current, trackRef.current))}
              className="h-full w-full object-cover"
            />
            <span className="absolute left-[26px] top-[74px] w-[38px] h-[38px] border-l-[3px] border-t-[3px] border-[#e6c15c] rounded-tl-md" />
            <span className="absolute right-[26px] top-[74px] w-[38px] h-[38px] border-r-[3px] border-t-[3px] border-[#e6c15c] rounded-tr-md" />
            <span className="absolute left-[26px] bottom-[74px] w-[38px] h-[38px] border-l-[3px] border-b-[3px] border-[#e6c15c] rounded-bl-md" />
            <span className="absolute right-[26px] bottom-[74px] w-[38px] h-[38px] border-r-[3px] border-b-[3px] border-[#e6c15c] rounded-br-md" />
            {/* Ronda 3 — sólo tiene sentido junto al visor en vivo; fuera
                del ternario se pintaba sobre el error del fallback. */}
            <span className="absolute left-0 right-0 bottom-[26px] text-center text-[13.5px] font-medium leading-snug text-[#e8d9bd]">
              Encuadra la hoja completa, con la firma visible
            </span>
          </>
        )}
        <canvas ref={canvasRef} className="hidden" data-testid="manifest-camera-canvas" />
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
