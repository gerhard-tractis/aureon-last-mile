'use client';

import { useEffect } from 'react';
import { DockLabel } from '@/components/distribution/DockLabel';

export interface PrintZone {
  id: string;
  code: string;
  name: string;
}

interface PrintLabelsProps {
  zones: PrintZone[];
}

export function PrintLabels({ zones }: PrintLabelsProps) {
  useEffect(() => {
    if (zones.length === 0) return;
    // bwip-js generates the SVG synchronously in DockLabel's useMemo, so the
    // DOM is complete after React's first commit. The small timeout gives the
    // browser one paint cycle to render the SVGs before snapshotting for print.
    const timeoutId = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timeoutId);
  }, [zones]);

  if (zones.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        No hay andenes para imprimir.
      </div>
    );
  }

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        @media print {
          body { background: #fff; margin: 0; padding: 0; }
          /* Hide all body descendants and reset positioning on them so the
             print root's containing block falls through to <body> (which
             equals the print page). display: none would cascade and hide
             descendants — visibility preserves layout but suppresses paint. */
          body * {
            visibility: hidden !important;
            position: static !important;
          }
          .dock-label-print-root,
          .dock-label-print-root * { visibility: visible !important; }
          .dock-label-print-root {
            position: absolute !important;
            left: 0;
            top: 0;
            width: 100%;
          }
          .dock-label { page-break-after: always; }
          .dock-label:last-child { page-break-after: auto; }
        }
      `}</style>
      <div className="dock-label-print-root">
        {zones.map((zone) => (
          <DockLabel key={zone.id} code={zone.code} name={zone.name} />
        ))}
      </div>
    </>
  );
}
