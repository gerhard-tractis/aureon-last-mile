'use client';

import { MissingPackageRow } from './MissingPackageRow';
import { timeLabel } from '@/lib/pickup/pickupMobileHelpers';
import { missingHeadingLabel } from '@/lib/pickup/reviewCloseGate';
import type { ReviewCounts, UnexpectedScan } from '@/lib/pickup/reviewCloseGate';
import type { MissingPackage } from '@/hooks/pickup/useDiscrepancies';

interface UnverifiedPackagesBlockProps {
  counts: ReviewCounts;
  missingPackages: MissingPackage[];
  notFoundScans: UnexpectedScan[];
  noteMap: Map<string, string>;
  onSaveNote: (packageId: string, note: string) => void;
}

/**
 * spec-80 fase 2, mock `5e`. Validated against the real design (`5e Cierre
 * con faltantes`, `docs/design/Recogida.dc.html`) after an earlier round
 * built this from spec prose alone:
 *
 *   - "Faltan N paquetes" / "X de Y verificados" live INSIDE the red warning
 *     card together with the literal sentence, not in a separate header —
 *     the spec's prose summarized them as a "cabecera" but the mock groups
 *     all three in one status-error card.
 *   - `SIN VERIFICAR · N` and `NO ESTABAN EN LA CARGA · N` use a `·`
 *     separator, not `(N)`.
 *   - the ajenos block is status-error styled (red), with a scan timestamp
 *     ("escaneado HH:MM · no pertenece a este manifiesto"), not the
 *     status-warning/AlertTriangle styling built in the first round.
 *
 * Renders nothing with zero missing packages AND zero unexpected barcodes —
 * "con 0 faltantes la pantalla no bloquea".
 */
export function UnverifiedPackagesBlock({
  counts,
  missingPackages,
  notFoundScans,
  noteMap,
  onSaveNote,
}: UnverifiedPackagesBlockProps) {
  if (missingPackages.length === 0 && notFoundScans.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {missingPackages.length > 0 && (
        <>
          <div className="flex flex-col gap-4 rounded-2xl p-4 bg-status-error-bg border-2 border-status-error-border">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex-none w-11 h-11 rounded-xl bg-status-error grid place-items-center text-background font-bold"
              >
                !
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="font-semibold text-lg text-status-error">
                  {missingHeadingLabel(counts.missingCount)}
                </span>
                <span className="text-sm text-text">
                  {counts.verifiedCount} de {counts.totalCount} verificados
                </span>
              </div>
            </div>
            <span className="text-sm text-text">
              Si cierras ahora, los {counts.missingCount} quedan registrados
              como faltantes a tu nombre y el cliente firma sobre esa cifra.
            </span>
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wide text-text-secondary">
              SIN VERIFICAR · {missingPackages.length}
            </h2>
            {missingPackages.map((pkg) => (
              <MissingPackageRow
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

      {notFoundScans.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-text-secondary">
            NO ESTABAN EN LA CARGA · {notFoundScans.length}
          </h2>
          {notFoundScans.map(({ barcode, scannedAt }) => (
            <div
              key={barcode}
              className="flex flex-col gap-1 p-3 rounded-xl bg-status-error-bg border border-status-error-border"
            >
              <span className="font-mono text-sm font-semibold text-status-error">
                {barcode}
              </span>
              <span className="text-xs text-text-secondary">
                {scannedAt ? `escaneado ${timeLabel(scannedAt)} · ` : ''}
                no pertenece a este manifiesto
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
