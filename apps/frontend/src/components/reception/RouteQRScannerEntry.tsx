'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ROUTE_UUID_REGEX as UUID_REGEX, resolveRouteId } from '@/lib/reception/route-ref';
import { useOpenRouteReception } from '@/hooks/reception/useOpenRouteReception';
import { Html5Qrcode } from 'html5-qrcode';

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
 * pickup route's QR (payload = route UUID) or type the short `PR-YYYY-NNNN`
 * code into the input. Only the code path needs a lookup, to turn the code
 * into an id.
 *
 * The scan is what ends the trip. It no longer reads `pickup_routes` to
 * second-guess the status client-side; it calls `open_route_reception`, which
 * checks the status, creates the batch, stamps the arrival, freezes
 * `expected_count` and takes the route lock in one transaction. An arriving
 * truck is `in_progress` — the normal case, and the reason the old
 * "aún no está en tránsito" gate had to go. `received` and `cancelled` are
 * rejected by the server, in Spanish, and that message is shown as-is.
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
  const openReception = useOpenRouteReception();
  const { mutate: openRouteReception } = openReception;

  const resolveAndNavigate = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      setIsLooking(true);
      setLookupResult(null);

      try {
        const routeId = UUID_REGEX.test(trimmed)
          ? trimmed
          : await resolveRouteId(operatorId, trimmed.toUpperCase());

        if (!routeId) {
          setLookupResult({ type: 'error', message: 'Ruta no encontrada' });
          return;
        }

        openRouteReception(
          { routeId },
          {
            onSuccess: () => {
              onResolved?.();
              router.push(`/app/reception/route/${routeId}`);
            },
            onError: (error: Error) => {
              const message = error.message || 'No se pudo abrir la recepción';
              setLookupResult({
                type: /ya fue recibida/i.test(message) ? 'already_received' : 'error',
                message,
              });
            },
          },
        );
      } catch {
        setLookupResult({ type: 'error', message: 'Error al buscar ruta' });
      } finally {
        setIsLooking(false);
      }
    },
    [operatorId, router, onResolved, openRouteReception],
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
      const running = scanner;
      scanner = null;
      if (!running) return;
      // html5-qrcode THROWS SYNCHRONOUSLY from stop() when the scanner never
      // started ("Cannot stop, scanner is not running or paused") — it does not
      // return a rejected promise, so the old `.catch()` never saw it. A throw
      // out of an effect cleanup unmounts the tree into the error boundary, and
      // the whole reception screen goes white. That is the normal path on any
      // dock terminal without camera permission: open the QR dialog, close it,
      // lose the app.
      const clear = () => { try { running.clear(); } catch { /* already gone */ } };
      try {
        Promise.resolve(running.stop()).catch(() => {}).finally(clear);
      } catch {
        clear();
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
            disabled={isLooking || openReception.isPending}
            aria-label="Buscar ruta"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
