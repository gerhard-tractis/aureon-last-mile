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
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
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
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <Package className="h-5 w-5 mx-auto text-gray-500 mb-1" />
            <p className="text-2xl font-bold text-gray-900" data-testid="expected-count">
              {expectedCount}
            </p>
            <p className="text-xs text-gray-500">Esperados</p>
          </div>

          {/* Received */}
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <CheckCircle className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold text-green-700" data-testid="received-count">
              {receivedCount}
            </p>
            <p className="text-xs text-green-600">Recibidos</p>
          </div>

          {/* Missing */}
          <div
            className={`text-center p-3 rounded-lg ${
              missingCount > 0 ? 'bg-red-50' : 'bg-gray-50'
            }`}
          >
            <AlertTriangle
              className={`h-5 w-5 mx-auto mb-1 ${
                missingCount > 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            />
            <p
              className={`text-2xl font-bold ${
                missingCount > 0 ? 'text-red-700' : 'text-gray-500'
              }`}
              data-testid="missing-count"
            >
              {missingCount}
            </p>
            <p
              className={`text-xs ${
                missingCount > 0 ? 'text-red-600' : 'text-gray-500'
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
