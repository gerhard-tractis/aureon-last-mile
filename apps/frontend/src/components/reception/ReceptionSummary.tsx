'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Package, CheckCircle, AlertTriangle } from 'lucide-react';

interface ReceptionSummaryProps {
  expectedCount: number;
  receivedCount: number;
}

export function ReceptionSummary({
  expectedCount,
  receivedCount,
}: ReceptionSummaryProps) {
  const missingCount = Math.max(0, expectedCount - receivedCount);
  const allReceived = missingCount === 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Status banner */}
        <div
          data-testid="summary-status"
          className={`flex items-center gap-2 p-3 rounded-lg ${
            allReceived
              ? 'bg-status-success-bg text-status-success border border-status-success-border'
              : 'bg-status-warning-bg text-status-warning border border-status-warning-border'
          }`}
        >
          {allReceived ? (
            <>
              <CheckCircle className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium">Todos los paquetes recibidos</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium">
                {missingCount} paquetes faltantes
              </span>
            </>
          )}
        </div>

        {/* Count cards */}
        <div className="grid grid-cols-3 gap-3">
          {/* Expected */}
          <div className="text-center p-3 bg-surface-raised rounded-lg">
            <Package className="h-5 w-5 mx-auto text-text-secondary mb-1" />
            <p className="text-2xl font-bold text-text" data-testid="expected-count">
              {expectedCount}
            </p>
            <p className="text-xs text-text-secondary">Esperados</p>
          </div>

          {/* Received */}
          <div className="text-center p-3 bg-status-success-bg rounded-lg">
            <CheckCircle className="h-5 w-5 mx-auto text-status-success mb-1" />
            <p className="text-2xl font-bold text-status-success" data-testid="received-count">
              {receivedCount}
            </p>
            <p className="text-xs text-status-success">Recibidos</p>
          </div>

          {/* Missing */}
          <div
            className={`text-center p-3 rounded-lg ${
              missingCount > 0 ? 'bg-status-error-bg' : 'bg-surface-raised'
            }`}
          >
            <AlertTriangle
              className={`h-5 w-5 mx-auto mb-1 ${
                missingCount > 0 ? 'text-status-error' : 'text-text-muted'
              }`}
            />
            <p
              className={`text-2xl font-bold ${
                missingCount > 0 ? 'text-status-error' : 'text-text-secondary'
              }`}
              data-testid="missing-count"
            >
              {missingCount}
            </p>
            <p
              className={`text-xs ${
                missingCount > 0 ? 'text-status-error' : 'text-text-secondary'
              }`}
            >
              Faltantes
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
