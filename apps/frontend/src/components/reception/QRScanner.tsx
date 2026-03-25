'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createSPAClient } from '@/lib/supabase/client';
import { Html5Qrcode } from 'html5-qrcode';

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
  const [manualInput, setManualInput] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [cameraError, setCameraError] = useState(false);

  const lookupManifest = useCallback(
    async (manifestId: string) => {
      if (!UUID_REGEX.test(manifestId)) {
        setLookupResult({ type: 'error', message: 'Código QR no válido' });
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
          setLookupResult({ type: 'error', message: 'Manifiesto no encontrado' });
          return;
        }

        if (data.reception_status === 'received') {
          const completedReception = (
            data.hub_receptions as Array<{
              id: string;
              status: string;
              completed_at: string | null;
              received_by_user: { full_name: string } | null;
            }>
          ).find((r) => r.status === 'completed');

          const receiverName = completedReception?.received_by_user?.full_name ?? 'Desconocido';
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

        const receptions = data.hub_receptions as Array<{ id: string; status: string }>;
        const activeReception = receptions.find(
          (r) => r.status === 'pending' || r.status === 'in_progress'
        );

        if (activeReception) {
          onClose();
          router.push(`/app/reception/scan/${activeReception.id}`);
        } else {
          setLookupResult({ type: 'error', message: 'No hay recepción pendiente para esta carga' });
        }
      } catch {
        setLookupResult({ type: 'error', message: 'Error al buscar manifiesto' });
      } finally {
        setIsLooking(false);
      }
    },
    [router, onClose]
  );

  // Start html5-qrcode scanner
  useEffect(() => {
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;

    async function startScanner() {
      try {
        const qr = new Html5Qrcode('qr-reader');
        scanner = qr;
        await qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            lookupManifest(decodedText);
          },
          () => { /* ignore per-frame decode errors */ }
        );
      } catch {
        setCameraError(true);
      }
    }

    startScanner();

    return () => {
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => {
          scanner?.clear();
        });
      }
    };
  }, [lookupManifest]);

  const handleManualSubmit = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    lookupManifest(trimmed);
  };

  return (
    <div className="flex flex-col bg-black/90">
      {/* Camera viewfinder */}
      <div className="relative flex items-center justify-center min-h-[300px]">
        {/* Always render qr-reader; hide it on camera error */}
        <div id="qr-reader" className={cameraError ? 'hidden' : 'w-full'} />
        {cameraError && (
          <div className="text-center text-white p-8">
            <Camera className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm opacity-75">
              No se pudo acceder a la cámara.
              <br />
              Usa el campo manual abajo.
            </p>
          </div>
        )}
        {!cameraError && (
          <div className="absolute z-10 w-64 h-64 border-2 border-white/60 rounded-xl pointer-events-none">
            <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
          </div>
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
        <p className="text-xs text-text-muted mb-2">O ingresa el ID manualmente:</p>
        <div className="flex gap-2">
          <Input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="ID del manifiesto (UUID)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleManualSubmit();
            }}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={handleManualSubmit}
            disabled={isLooking}
            aria-label="Buscar"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
