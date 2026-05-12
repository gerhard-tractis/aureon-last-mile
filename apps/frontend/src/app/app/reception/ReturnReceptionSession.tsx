'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, CheckCircle2, Circle, ScanBarcode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useReturnReceptionSession } from '@/hooks/reception/useReturnReceptionSession';

interface ReturnReceptionSessionProps {
  operatorId: string | null;
  externalRouteId: string;
  onBack: () => void;
}

type ScanFeedback = 'received' | 'not_found' | 'route_mismatch' | 'duplicate' | null;

const FEEDBACK_LABELS: Record<NonNullable<ScanFeedback>, string> = {
  received: 'Recibido',
  not_found: 'No encontrado',
  route_mismatch: 'Ruta incorrecta',
  duplicate: 'Ya registrado',
};

const FEEDBACK_COLORS: Record<NonNullable<ScanFeedback>, string> = {
  received: 'text-status-success',
  not_found: 'text-status-error',
  route_mismatch: 'text-status-error',
  duplicate: 'text-status-warning',
};

export function ReturnReceptionSession({
  operatorId,
  externalRouteId,
  onBack,
}: ReturnReceptionSessionProps) {
  const { expectedCount, receivedCount, packages, scan } = useReturnReceptionSession({
    operatorId,
    externalRouteId,
  });

  const [barcode, setBarcode] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [isScanning, setIsScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleScan = async () => {
    const trimmed = barcode.trim();
    if (!trimmed || isScanning) return;
    setIsScanning(true);
    setFeedback(null);
    try {
      const res = await scan(trimmed);
      setFeedback(res.result as ScanFeedback);
    } finally {
      setBarcode('');
      setIsScanning(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleScan();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Volver">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Volver</span>
        </Button>
        <h2 className="text-lg font-bold text-text">Retorno: {externalRouteId}</h2>
      </div>

      {/* Progress */}
      <p className="text-sm text-text-secondary font-mono">
        {receivedCount} / {expectedCount} paquetes
      </p>

      {/* Scanner input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escanear código de barras..."
          className="font-mono"
          disabled={isScanning}
          autoFocus
        />
        <Button onClick={() => void handleScan()} disabled={isScanning || !barcode.trim()}>
          <ScanBarcode className="h-4 w-4" />
          <span className="sr-only">Scan</span>
        </Button>
      </div>

      {/* Scan feedback */}
      {feedback && (
        <p className={`text-sm font-semibold ${FEEDBACK_COLORS[feedback]}`}>
          {FEEDBACK_LABELS[feedback]}
        </p>
      )}

      {/* Package list */}
      <div className="space-y-2">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className="bg-surface border border-border rounded-lg p-3 flex items-center gap-3"
          >
            {pkg.received ? (
              <CheckCircle2
                className="h-5 w-5 text-status-success shrink-0"
                data-testid="pkg-received"
              />
            ) : (
              <Circle className="h-5 w-5 text-text-muted shrink-0" data-testid="pkg-pending" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono font-semibold text-text">{pkg.label}</p>
              <p className="text-xs text-text-secondary">{pkg.order_number}</p>
              {pkg.return_reason && (
                <p className="text-xs text-text-muted mt-0.5">{pkg.return_reason}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Finalizar */}
      <Button variant="outline" className="w-full" onClick={onBack}>
        Finalizar recepción
      </Button>
    </div>
  );
}
