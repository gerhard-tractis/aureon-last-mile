'use client';

import { useRef, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, ScanBarcode } from 'lucide-react';

interface LastScan {
  success: boolean;
  message: string;
}

interface BatchConfirmationProps {
  zoneName: string;
  zoneCode: string;
  packageCount: number;
  onConfirm: (scannedCode: string) => void;
  lastScan: LastScan | null;
}

export function BatchConfirmation({
  zoneName,
  zoneCode,
  packageCount,
  onConfirm,
  lastScan,
}: BatchConfirmationProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, [lastScan]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      const scanned = value.trim();
      setValue('');
      onConfirm(scanned);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Resumen del lote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Andén</p>
          <p className="text-lg font-semibold">{zoneName}</p>
          <p className="text-sm text-muted-foreground mt-2">Paquetes escaneados</p>
          <p className="text-lg font-semibold">{packageCount} paquetes</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Escanear andén para confirmar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Escanee el código del andén{' '}
            <span className="font-mono font-semibold text-foreground">{zoneCode}</span>{' '}
            para cerrar el lote.
          </p>
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => inputRef.current?.focus(), 100)}
            placeholder="Escanear código de andén..."
            className="text-lg font-mono"
            autoComplete="off"
            aria-label="Escáner de confirmación de andén"
          />
          {lastScan && (
            lastScan.success ? (
              <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md">
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                <span className="text-sm font-medium text-green-800">{lastScan.message}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-md">
                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                <span className="text-sm font-medium text-red-800">{lastScan.message}</span>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
