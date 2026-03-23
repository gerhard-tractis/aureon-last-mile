'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Camera, Search } from 'lucide-react';
import { createSPAClient } from '@/lib/supabase/client';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QRScannerProps {
  onClose: () => void;
  operatorId: string;
}

interface LookupResult {
  type: 'error' | 'already_received';
  message: string;
  detail?: string;
}

export function QRScanner({ onClose, operatorId: _operatorId }: QRScannerProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manualInput, setManualInput] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [cameraError, setCameraError] = useState(false);

  // Start camera for QR scanning
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setCameraError(true);
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const lookupManifest = useCallback(
    async (manifestId: string) => {
      if (!UUID_REGEX.test(manifestId)) {
        setLookupResult({
          type: 'error',
          message: 'Código QR no válido',
        });
        return;
      }

      setIsLooking(true);
      setLookupResult(null);

      try {
        const supabase = createSPAClient();
        const { data, error } = await supabase
          .from('manifests')
          .select(
            `id, reception_status,
             hub_receptions(id, status, completed_at,
               received_by_user:users!hub_receptions_received_by_fkey(full_name)
             )`
          )
          .eq('id', manifestId)
          .is('deleted_at', null)
          .single();

        if (error || !data) {
          setLookupResult({
            type: 'error',
            message: 'Manifiesto no encontrado',
          });
          return;
        }

        // Check if already received
        if (data.reception_status === 'received') {
          const completedReception = (
            data.hub_receptions as Array<{
              id: string;
              status: string;
              completed_at: string | null;
              received_by_user: { full_name: string } | null;
            }>
          ).find((r) => r.status === 'completed');

          const receiverName =
            completedReception?.received_by_user?.full_name ?? 'Desconocido';
          const completedAt = completedReception?.completed_at
            ? new Date(completedReception.completed_at).toLocaleString('es-CL')
            : '';

          setLookupResult({
            type: 'already_received',
            message: 'Esta carga ya fue recibida',
            detail: `Recibida por ${receiverName} el ${completedAt}`,
          });
          return;
        }

        // Find or create reception — navigate to scan page
        const receptions = data.hub_receptions as Array<{
          id: string;
          status: string;
        }>;
        const activeReception = receptions.find(
          (r) => r.status === 'pending' || r.status === 'in_progress'
        );

        if (activeReception) {
          router.push(`/app/reception/scan/${activeReception.id}`);
        } else {
          setLookupResult({
            type: 'error',
            message: 'No hay recepción pendiente para esta carga',
          });
        }
      } catch {
        setLookupResult({
          type: 'error',
          message: 'Error al buscar manifiesto',
        });
      } finally {
        setIsLooking(false);
      }
    },
    [router]
  );

  const handleManualSubmit = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    lookupManifest(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 text-white">
        <h2 className="text-lg font-semibold">Escanear QR de manifiesto</h2>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="p-2 rounded-full hover:bg-white/10"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Camera viewfinder */}
      <div className="flex-1 relative flex items-center justify-center">
        {cameraError ? (
          <div className="text-center text-white p-8">
            <Camera className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm opacity-75">
              No se pudo acceder a la cámara.
              <br />
              Usa el campo manual abajo.
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Scan frame overlay */}
            <div className="relative z-10 w-64 h-64 border-2 border-white/60 rounded-xl">
              <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
              <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
              <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
              <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
            </div>
            {/* TODO: Integrate html5-qrcode or similar library for actual QR decoding
                When a QR is decoded, call lookupManifest(decodedValue) */}
          </>
        )}
      </div>

      {/* Result / error messages */}
      {lookupResult && (
        <div
          className={`mx-4 mb-2 p-3 rounded-lg text-sm ${
            lookupResult.type === 'already_received'
              ? 'bg-status-warning-bg text-status-warning'
              : 'bg-status-error-bg text-status-error'
          }`}
        >
          <p className="font-medium">{lookupResult.message}</p>
          {lookupResult.detail && (
            <p className="mt-1 text-xs">{lookupResult.detail}</p>
          )}
        </div>
      )}

      {/* Manual input fallback */}
      <div className="p-4 bg-surface">
        <p className="text-xs text-text-muted mb-2">
          O ingresa el ID manualmente:
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="ID del manifiesto (UUID)"
            className="flex-1 px-3 py-2 rounded-lg bg-surface-raised text-text text-sm
                       border border-border focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleManualSubmit();
            }}
          />
          <button
            onClick={handleManualSubmit}
            disabled={isLooking}
            aria-label="Buscar"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm
                       hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
