'use client';

import { useEffect } from 'react';
import { PackageLabel } from '@/components/pickup/PackageLabel';
import { useMarkManifestLabelsPrinted } from '@/hooks/pickup/useMarkManifestLabelsPrinted';
import type { ManifestLabelRow } from '@/lib/pickup/manifest-label-types';

interface PrintPackageLabelsProps {
  manifestId: string;
  labels: ManifestLabelRow[];
}

// spec-53 — print root for 100×100mm Aureon package labels. Copies the
// isolation approach from distribution/settings/labels/print/PrintLabels.tsx:
// @page sizing, the visibility:hidden reset on body * (not display:none,
// which would cascade into the print root's own descendants), and
// window.print() behind a one-paint-cycle timeout so bwip-js's synchronously
// rendered SVGs are painted before the browser snapshots for print.
export function PrintPackageLabels({ manifestId, labels }: PrintPackageLabelsProps) {
  const { mutateAsync: markPrinted } = useMarkManifestLabelsPrinted();

  useEffect(() => {
    if (labels.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      window.print();
      // Browsers report no print-confirmation event, so this records only
      // that a print job was dispatched — not that it succeeded. See spec-53.
      void markPrinted({ manifestId });
    }, 100);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, manifestId]);

  if (labels.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        No hay etiquetas para imprimir.
      </div>
    );
  }

  return (
    <>
      <style>{`
        @page { size: 100mm 100mm; margin: 0; }
        @media print {
          body { background: #fff; margin: 0; padding: 0; }
          body * {
            visibility: hidden !important;
            position: static !important;
          }
          .package-label-print-root,
          .package-label-print-root * { visibility: visible !important; }
          .package-label-print-root {
            position: absolute !important;
            left: 0;
            top: 0;
            width: 100%;
          }
          .package-label { page-break-after: always; }
          .package-label:last-child { page-break-after: auto; }
        }
      `}</style>
      <div className="package-label-print-root">
        {labels.map((row) => (
          <PackageLabel key={row.package_id} data={row} />
        ))}
      </div>
    </>
  );
}
