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

// Hardware scanners that aren't configured to send a CR/Enter suffix arrive
// as a fast burst of keystrokes with no terminator. We detect the burst by
// the elapsed time between the first character and the moment typing stops:
// scanners drop the full barcode in well under 200 ms, while human typing
// pauses much longer between characters.
const SCANNER_BURST_MAX_MS = 200;
const IDLE_DEBOUNCE_MS = 120;
const MIN_AUTO_SUBMIT_LENGTH = 4;

export function ReceptionScanner({
  onScan,
  disabled,
  lastScanResult,
}: ReceptionScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferStartRef = useRef<number | null>(null);

  // Auto-focus on mount and after each scan. preventScroll keeps the page
  // from jumping back to the top when focus returns to this input — common
  // when the user marks a package received from deeper down the list and the
  // mutation toggles `disabled`, re-running this effect.
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [disabled]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fireScan = (submitValue: string) => {
    const trimmed = submitValue.trim();
    if (!trimmed) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    bufferStartRef.current = null;
    onScan(trimmed);
    setValue('');
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (newValue === '') {
      bufferStartRef.current = null;
      return;
    }
    if (bufferStartRef.current === null) {
      bufferStartRef.current = Date.now();
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const start = bufferStartRef.current;
      const finalValue = inputRef.current?.value ?? newValue;
      if (
        start !== null &&
        Date.now() - start <= SCANNER_BURST_MAX_MS &&
        finalValue.trim().length >= MIN_AUTO_SUBMIT_LENGTH
      ) {
        fireScan(finalValue);
      }
    }, IDLE_DEBOUNCE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      fireScan(value);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
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
