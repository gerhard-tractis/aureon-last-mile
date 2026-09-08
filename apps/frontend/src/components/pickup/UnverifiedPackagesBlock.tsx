'use client';

import { AlertTriangle } from 'lucide-react';
import { DiscrepancyItem } from './DiscrepancyItem';
import type { MissingPackage } from '@/hooks/pickup/useDiscrepancies';

interface UnverifiedPackagesBlockProps {
  missingPackages: MissingPackage[];
  notFoundBarcodes: string[];
  noteMap: Map<string, string>;
  onSaveNote: (packageId: string, note: string) => void;
}

/**
 * spec-80 fase 2, mock `5e`. The block spec-47's review screen never had:
 * the literal "if you close now, N are recorded as missing under your
 * name" warning, the SIN VERIFICAR list (one Nota per bulto), and the
 * NO ESTABAN EN LA CARGA list of barcodes scanned that don't belong to
 * this manifest (pickup_scans.scan_result = 'not_found').
 *
 * Renders nothing with zero missing packages AND zero unexpected barcodes —
 * "con 0 faltantes la pantalla no bloquea".
 */
export function UnverifiedPackagesBlock({
  missingPackages,
  notFoundBarcodes,
  noteMap,
  onSaveNote,
}: UnverifiedPackagesBlockProps) {
  if (missingPackages.length === 0 && notFoundBarcodes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {missingPackages.length > 0 && (
        <>
          <div className="bg-status-warning-bg border border-status-warning-border rounded-lg p-3">
            <p className="text-sm text-text">
              Si cierras ahora, los {missingPackages.length} quedan
              registrados como faltantes a tu nombre y el cliente firma sobre
              esa cifra.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-text">
              SIN VERIFICAR ({missingPackages.length})
            </h2>
            {missingPackages.map((pkg) => (
              <DiscrepancyItem
                key={pkg.id}
                packageId={pkg.id}
                packageLabel={pkg.label}
                orderNumber={pkg.order_number}
                existingNote={noteMap.get(pkg.id) ?? ''}
                onSaveNote={onSaveNote}
              />
            ))}
          </div>
        </>
      )}

      {notFoundBarcodes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-text">
            NO ESTABAN EN LA CARGA ({notFoundBarcodes.length})
          </h2>
          {notFoundBarcodes.map((barcode) => (
            <div
              key={barcode}
              className="flex items-center gap-2 p-2 bg-status-warning-bg border border-status-warning-border rounded-lg"
            >
              <AlertTriangle className="h-4 w-4 text-status-warning" />
              <span className="font-mono text-sm text-text">{barcode}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
