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

  // Auto-focus on mount and after each scan
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onScan(value.trim());
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
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
              setTimeout(() => inputRef.current?.focus(), 100);
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
      <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md">
        <CheckCircle className="h-5 w-5 text-green-500" />
        <span className="text-sm font-medium text-green-800">
          Paquete recibido
        </span>
      </div>
    );
  }

  if (scanResult === 'duplicate') {
    return (
      <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
        <Copy className="h-5 w-5 text-yellow-500" />
        <span className="text-sm font-medium text-yellow-800">
          Paquete ya escaneado
        </span>
      </div>
    );
  }

  // not_found
  return (
    <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-md">
      <XCircle className="h-5 w-5 text-red-500" />
      <span className="text-sm font-medium text-red-800">
        {message ?? 'Paquete no encontrado'}
      </span>
    </div>
  );
}
