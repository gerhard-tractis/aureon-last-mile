'use client';

import { useRef, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { CheckCircle, XCircle, Copy } from 'lucide-react';

interface ScanFeedback {
  scanResult: string;
  message?: string;
}

interface ReceptionScannerProps {
  onScan: (barcode: string) => void;
  disabled?: boolean;
  lastScanResult: ScanFeedback | null;
}

export function ReceptionScanner({
  onScan,
  disabled,
  lastScanResult,
}: ReceptionScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  // Auto-focus on mount and after each scan. preventScroll keeps the page
  // from jumping back to the top when focus returns to this input — common
  // when the user marks a package received from deeper down the list and the
  // mutation toggles `disabled`, re-running this effect.
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onScan(value.trim());
      setValue('');
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!disabled) {
              setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
            }
          }}
          placeholder="Escanear código de barras..."
          disabled={disabled}
          className="text-lg font-mono"
          autoComplete="off"
          aria-label="Escáner de recepción"
        />
      </div>

      {lastScanResult && <ScanFeedbackBanner result={lastScanResult} />}
    </div>
  );
}

function ScanFeedbackBanner({ result }: { result: ScanFeedback }) {
  const { scanResult, message } = result;

  if (scanResult === 'received') {
    return (
      <div className="flex items-center gap-2 p-2 bg-status-success-bg border border-status-success-border rounded-md">
        <CheckCircle className="h-5 w-5 text-status-success" />
        <span className="text-sm font-medium text-status-success">
          Paquete recibido
        </span>
      </div>
    );
  }

  if (scanResult === 'duplicate') {
    return (
      <div className="flex items-center gap-2 p-2 bg-status-warning-bg border border-status-warning-border rounded-md">
        <Copy className="h-5 w-5 text-status-warning" />
        <span className="text-sm font-medium text-status-warning">
          Paquete ya escaneado
        </span>
      </div>
    );
  }

  // not_found
  return (
    <div className="flex items-center gap-2 p-2 bg-status-error-bg border border-status-error-border rounded-md">
      <XCircle className="h-5 w-5 text-status-error" />
      <span className="text-sm font-medium text-status-error">
        {message ?? 'Paquete no encontrado'}
      </span>
    </div>
  );
}
