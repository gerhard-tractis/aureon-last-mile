'use client';

import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Package } from 'lucide-react';

interface QRHandoffProps {
  qrPayload: string;
  retailerName: string | null;
  packageCount: number;
  onDismiss: () => void;
}

/**
 * Full-screen QR code display for driver handoff.
 *
 * Shows the manifest UUID as a QR code for the hub receiver to scan.
 * Displays retailer name, package count, and instructions.
 */
export function QRHandoff({
  qrPayload,
  retailerName,
  packageCount,
  onDismiss,
}: QRHandoffProps) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-between p-6">
      {/* Header */}
      <div className="w-full text-center space-y-2">
        <h1 className="text-xl font-bold text-gray-900">
          Entrega en Bodega
        </h1>
        <p className="text-sm text-gray-500">
          {retailerName ?? 'Carga'} — {loadLabel(retailerName)}
        </p>
      </div>

      {/* QR Code Section */}
      <div className="flex flex-col items-center space-y-6 flex-1 justify-center">
        <div className="bg-white p-4 rounded-2xl shadow-lg border border-gray-100">
          <QRCodeSVG
            value={qrPayload}
            size={256}
            level="H"
            marginSize={4}
          />
        </div>

        {/* Package count */}
        <div className="flex items-center gap-2 text-gray-700">
          <Package className="h-5 w-5" />
          <span className="text-lg font-semibold">
            {packageCount} paquetes
          </span>
        </div>

        {/* Instructions */}
        <p className="text-sm text-gray-500 text-center max-w-xs">
          Muestre este código al encargado de bodega para registrar la entrega
        </p>
      </div>

      {/* Dismiss Button */}
      <div className="w-full pt-4">
        <button
          onClick={onDismiss}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </button>
      </div>
    </div>
  );
}

function loadLabel(retailerName: string | null): string {
  if (retailerName) {
    return `Carga de ${retailerName}`;
  }
  return 'Carga pendiente de recepción';
}
