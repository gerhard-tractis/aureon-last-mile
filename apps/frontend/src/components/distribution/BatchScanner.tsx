'use client';

import { useRef, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { CheckCircle, XCircle } from 'lucide-react';
import type { DockScanValidationResult } from '@/lib/distribution/dock-scan-validator';

interface BatchScannerProps {
  onScan: (barcode: string) => void;
  lastResult: DockScanValidationResult | null;
  disabled: boolean;
}

export function BatchScanner({ onScan, lastResult, disabled }: BatchScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled, lastResult]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() && !disabled) {
      e.preventDefault();
      onScan(value.trim());
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="space-y-2">
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!disabled) {
            setTimeout(() => inputRef.current?.focus(), 100);
          }
        }}
        placeholder="Escanear código de barras..."
        disabled={disabled}
        className="text-lg font-mono"
        autoComplete="off"
        aria-label="Escáner de lote"
      />
      {lastResult && <ScanFeedbackBanner result={lastResult} />}
    </div>
  );
}

function ScanFeedbackBanner({ result }: { result: DockScanValidationResult }) {
  if (result.scanResult === 'accepted') {
    return (
      <div className="flex items-center gap-2 p-2 bg-status-success-bg border border-status-success-border rounded-md">
        <CheckCircle className="h-5 w-5 text-status-success shrink-0" />
        <span className="text-sm font-medium text-status-success">
          Aceptado
          {result.packageLabel ? (
            <> — <span>{result.packageLabel}</span></>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-status-error-bg border border-status-error-border rounded-md">
      <XCircle className="h-5 w-5 text-status-error shrink-0" />
      <span className="text-sm font-medium text-status-error">
        {result.message ?? 'Paquete no encontrado'}
      </span>
    </div>
  );
}
