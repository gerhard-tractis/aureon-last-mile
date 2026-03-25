'use client';

import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, Package } from 'lucide-react';
import { MetricCard } from '@/components/metrics/MetricCard';

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

        {/* MetricCards */}
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Esperados" value={expectedCount} icon={Package} />
          <MetricCard label="Recibidos" value={receivedCount} icon={CheckCircle} />
          <MetricCard
            label="Faltantes"
            value={missingCount}
            icon={AlertTriangle}
            className={
              missingCount > 0
                ? 'border-status-error-border bg-status-error-bg'
                : undefined
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
