'use client';

import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Package, ClipboardList } from 'lucide-react';

interface RouteQRViewProps {
  /** Route UUID — encoded into the QR. */
  routeId: string;
  /** Human-typable code shown in large mono — fallback for hub when scan fails. */
  code: string;
  manifestCount: number;
  packageCount: number;
  onDismiss: () => void;
}

/**
 * Full-screen post-close view. The hub scans the QR (payload=routeId) or
 * types the printed `code` to open the consolidated reception page.
 */
export function RouteQRView({
  routeId,
  code,
  manifestCount,
  packageCount,
  onDismiss,
}: RouteQRViewProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-between p-6">
      <div className="w-full text-center space-y-1">
        <h1 className="text-xl font-bold text-text">Entrega en bodega</h1>
        <p className="text-sm text-text-secondary">Muestra este QR al receptor</p>
      </div>

      <div className="flex flex-col items-center space-y-6 flex-1 justify-center">
        <div
          className="bg-surface p-4 rounded-2xl shadow-lg border border-border"
          data-testid="route-qr"
        >
          <QRCodeSVG value={routeId} size={256} level="H" marginSize={4} />
        </div>

        <p
          className="font-mono text-2xl font-bold tracking-wider text-text"
          data-testid="route-code"
        >
          {code}
        </p>

        <div className="flex gap-6 text-text">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <span className="font-semibold">{manifestCount} manifiestos</span>
          </div>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            <span className="font-semibold">{packageCount} paquetes</span>
          </div>
        </div>
      </div>

      <div className="w-full pt-4">
        <button
          onClick={onDismiss}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-surface-raised hover:opacity-80 text-text font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </button>
      </div>
    </div>
  );
}
