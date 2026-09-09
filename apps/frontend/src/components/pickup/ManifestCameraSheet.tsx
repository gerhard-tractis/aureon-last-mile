'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera as CameraIcon } from 'lucide-react';
import { validateManifestPhotoFile } from '@/lib/pickup/manifestPhotoValidation';

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
   * PR #713, M1/B2 — para quien monte esta pantalla siempre (convención
   * Radix `open`/`onOpenChange` del resto de `*Sheet.tsx`) en vez de
   * renderizarla condicionalmente. En `false`: libera el stream y no
   * renderiza nada (antes dejaba un overlay negro `fixed inset-0 z-50`
   * tapando la app). En `true` (default): pide cámara y renderiza.
   * `5g`/`5h` nunca deben estar abiertas a la vez — ambas son
   * `fixed inset-0 z-50`; quien las cablee es responsable de esa exclusión.
   */
  open?: boolean;
}

/**
 * spec-80 fase 4, mock `5g` — "cámara para el manifiesto firmado".
 *
 * El mock pide `expo-camera` (app Expo dormida, `apps/mobile`); esta es la
 * PWA. El respaldo con `<input type="file" capture="environment">` sigue el
 * patrón de `useCameraIntake.ts`/`CameraIntake.tsx` para este mismo bucket
 * — el encuadre en vivo con `getUserMedia` no tiene otro precedente en el
 * repo.
 *
 * No sube nada: `onCapture` entrega el frame como `File` a quien la monte
 * (5h, la revisión), que decide si sube de inmediato o encola sin red. Ese
 * cableado a `ManifestPhotoStrip`/`useUploadManifestDocument` queda fuera de
 * esta fase — ver el spec.
 *
 * M4 (seguimiento, tracked como checklist item en spec-80 fase 4) —
 * `role="dialog"`/`aria-modal` sí están; trampa de foco y manejo de
 * `Escape`/atrás de Android siguen sin implementarse.
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
  // B1 — el obturador NO se habilita hasta que el <video> reporte frames
  // reales (`loadedmetadata`, ambos ejes > 0). Antes estaba habilitado
  // desde el primer render, durante el diálogo de permiso del sistema: un
  // toque ahí producía un canvas sin señal — negro sólido, ~1.5MB, un File
  // "válido" como evidencia de custodia sin ninguna información real.
  const [videoReady, setVideoReady] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  useEffect(() => {
    // Ronda 3 de review del PR #713 — antes había un bloque `if (!open) {
    // stop tracks...; return; }` aquí. Era código muerto: React ejecuta la
    // limpieza del efecto ANTERIOR (que ya para el stream y limpia
    // `streamRef`) antes de correr este cuerpo con `open=false`, así que
    // `streamRef.current` ya es `null` para cuando esta rama se alcanzaría.
    // Verificado por mutación (borrarle el `stop()` a esa rama seguía en
    // verde). El único trabajo real que hacía falta era no pedir cámara.
    if (!open) return;

    let cancelled = false;
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

    if (!mediaDevices?.getUserMedia) {
      setUseFallbackInput(true);
      return;
    }

    // M-A — cuando la pista termina a mitad de sesión (permiso revocado,
    // segundo plano en iOS) un navegador real NO pone las dimensiones del
    // <video> a 0: queda congelado en el último frame. El chequeo de
    // dimensiones de `handleShutter` no detecta eso — saldría una foto
    // PLAUSIBLE del frame anterior (p.ej. la hoja ya subida), indistinguible
    // a simple vista en `5h`. Escuchar el fin de la pista sí lo detecta.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') setVideoReady(false);
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

        const handleTrackEnded = () => setVideoReady(false);
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', handleTrackEnded);
          track.addEventListener('mute', handleTrackEnded);
          trackCleanupFns.push(() => {
            track.removeEventListener('ended', handleTrackEnded);
            track.removeEventListener('mute', handleTrackEnded);
          });
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
      setVideoReady(false);
    };
  }, [open]);

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // Comprobación defensiva de última línea (defensa en profundidad, no el
    // detector principal — ver M-A arriba): si por lo que sea `videoWidth`/
    // `videoHeight` fueran 0 aquí (p.ej. una carrera justo tras
    // `loadedmetadata`), NO hay que inventarse un tamaño por defecto — eso
    // es exactamente lo que producía la foto negra en B1.
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // El tipo del File viene del Blob que `toBlob` realmente produjo,
        // no de un literal hardcodeado — no debe mentir sobre su contenido
        // en el Content-Type que ve Supabase Storage.
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

    // M3/M-B — el fallback pasa un File crudo de la cámara nativa, que
    // puede superar los 10MiB del bucket o venir con `type` vacío (varios
    // WebViews de Android). Validar aquí, con el operario delante — ver
    // lib/pickup/manifestPhotoValidation.ts.
    const result = validateManifestPhotoFile(file);
    if (!result.ok) {
      setFallbackError(result.error);
      return;
    }

    setFallbackError(null);
    onCapture(result.file);
  };

  // B2 — el efecto ya liberaba el stream con `open=false`, pero el JSX
  // nunca lo consultaba: dejaba un overlay negro tapando la PWA. Debe ir
  // DESPUÉS de todos los hooks — un return antes rompería las reglas de
  // hooks de React.
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
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setVideoReady(v.videoWidth > 0 && v.videoHeight > 0);
              }}
              className="h-full w-full object-cover"
            />
            <span className="absolute left-[26px] top-[74px] w-[38px] h-[38px] border-l-[3px] border-t-[3px] border-[#e6c15c] rounded-tl-md" />
            <span className="absolute right-[26px] top-[74px] w-[38px] h-[38px] border-r-[3px] border-t-[3px] border-[#e6c15c] rounded-tr-md" />
            <span className="absolute left-[26px] bottom-[74px] w-[38px] h-[38px] border-l-[3px] border-b-[3px] border-[#e6c15c] rounded-bl-md" />
            <span className="absolute right-[26px] bottom-[74px] w-[38px] h-[38px] border-r-[3px] border-b-[3px] border-[#e6c15c] rounded-br-md" />
            {/* Ronda 3 de review del PR #713 — vivía fuera del ternario y se
                pintaba encima del mensaje de error del fallback (ambos
                `absolute ... bottom-[26px]`). Sólo tiene sentido junto al
                visor en vivo, así que se mueve a esta rama. */}
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
