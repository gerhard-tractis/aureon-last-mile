'use client';

import { useEffect } from 'react';
import { XCircle, X } from 'lucide-react';

interface ScanResultPopupProps {
  visible: boolean;
  onDismiss: () => void;
}

export function ScanResultPopup({ visible, onDismiss }: ScanResultPopupProps) {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onDismiss, 5000);
      return () => clearTimeout(timer);
    }
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-status-error-bg border border-status-error-border rounded-lg shadow-lg p-4 flex items-center gap-3 max-w-sm"
      role="alert"
      onClick={onDismiss}
    >
      <XCircle className="h-6 w-6 text-status-error flex-shrink-0" />
      <div>
        {/* Review de fase 5, B2 — frase canónica del mock (`5d`), la misma
            que ya usa `ScanHistoryList.tsx:53` para el mismo evento
            (`scan_result === 'not_found'`). */}
        <p className="font-semibold text-text">NO ESTÁ EN LA CARGA</p>
        <p className="text-sm text-text-secondary">
          El código escaneado no corresponde a ningún bulto de este manifiesto
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="ml-auto text-text-muted hover:text-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
