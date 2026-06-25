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

interface RouteQRScannerEntryProps {
  operatorId: string;
  onResolved?: () => void;
  enableCamera?: boolean;
}

interface LookupResult {
  type: 'error' | 'already_received';
  message: string;
  detail?: string;
}

/**
 * Dual entry point for a hub receptionist: either point the camera at the
 * pickup route's QR (payload = route UUID) or type the short
 * `PR-YYYY-NNNN` code into the input. Both resolve to a `pickup_routes.id`
 * and navigate to `/app/reception/route/[routeId]`. Mirrors the old
 * per-manifest QRScanner but talks to `pickup_routes` and accepts the
 * human-typable code in addition to the UUID payload.
 */
export function RouteQRScannerEntry({
  operatorId,
  onResolved,
  enableCamera = true,
}: RouteQRScannerEntryProps) {
  const router = useRouter();
  const [manualInput, setManualInput] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [cameraError, setCameraError] = useState(false);

  const resolveAndNavigate = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      setIsLooking(true);
      setLookupResult(null);

      try {
        const supabase = createSPAClient();
        const isUuid = UUID_REGEX.test(trimmed);
        const query = supabase
          .from('pickup_routes')
          .select('id, status')
          .eq('operator_id', operatorId)
          .is('deleted_at', null)
          .limit(1);
        const { data, error } = isUuid
          ? await query.eq('id', trimmed)
          : await query.eq('code', trimmed.toUpperCase());

        if (error || !data || data.length === 0) {
          setLookupResult({ type: 'error', message: 'Ruta no encontrada' });
          return;
        }

        const route = data[0];
        if (route.status === 'received') {
          setLookupResult({
            type: 'already_received',
            message: 'Esta ruta ya fue recibida',
          });
          return;
        }
        if (route.status !== 'in_transit') {
          setLookupResult({
            type: 'error',
            message: 'La ruta aún no está en tránsito',
          });
          return;
        }

        onResolved?.();
        router.push(`/app/reception/route/${route.id}`);
      } catch {
        setLookupResult({ type: 'error', message: 'Error al buscar ruta' });
      } finally {
        setIsLooking(false);
      }
    },
    [operatorId, router, onResolved],
  );

  useEffect(() => {
    if (!enableCamera) return;
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;

    async function startScanner() {
      try {
        const qr = new Html5Qrcode('route-qr-reader');
        scanner = qr;
        await qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            resolveAndNavigate(decodedText);
          },
          () => {
            /* ignore per-frame decode errors */
          },
        );
      } catch {
        setCameraError(true);
      }
    }

    startScanner();
    return () => {
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => scanner?.clear());
      }
    };
  }, [enableCamera, resolveAndNavigate]);

  const handleManualSubmit = () => {
    resolveAndNavigate(manualInput);
  };

  return (
    <div className="flex flex-col bg-black/90">
      {enableCamera && (
        <div className="relative flex items-center justify-center min-h-[300px]">
          <div id="route-qr-reader" className={cameraError ? 'hidden' : 'w-full'} />
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
        </div>
      )}

      {lookupResult && (
        <div
          role="alert"
          className={`mx-4 mb-2 p-3 rounded-lg text-sm ${
            lookupResult.type === 'already_received'
              ? 'bg-status-warning-bg text-status-warning'
              : 'bg-status-error-bg text-status-error'
          }`}
        >
          <p className="font-medium">{lookupResult.message}</p>
          {lookupResult.detail && <p className="mt-1 text-xs">{lookupResult.detail}</p>}
        </div>
      )}

      <div className="p-4 bg-surface space-y-2">
        <p className="text-xs text-text-muted">
          Escanea el QR o ingresa el código de ruta (ej: PR-2026-0001):
        </p>
        <div className="flex gap-2">
          <Input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="PR-2026-0001"
            aria-label="Código de ruta"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleManualSubmit();
            }}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={handleManualSubmit}
            disabled={isLooking}
            aria-label="Buscar ruta"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
