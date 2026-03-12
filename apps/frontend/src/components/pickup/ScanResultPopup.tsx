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
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 rounded-lg shadow-lg p-4 flex items-center gap-3 max-w-sm"
      role="alert"
      onClick={onDismiss}
    >
      <XCircle className="h-6 w-6 text-red-500 flex-shrink-0" />
      <div>
        <p className="font-semibold text-red-800">Package Not Included</p>
        <p className="text-sm text-red-600">
          Barcode not found in this manifest
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="ml-auto text-red-400 hover:text-red-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
