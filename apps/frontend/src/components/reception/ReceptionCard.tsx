'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Package, Clock } from 'lucide-react';

interface ReceptionCardProps {
  retailerName: string | null;
  packageCount: number;
  completedAt: string | null;
  receptionStatus: 'awaiting_reception' | 'reception_in_progress';
  receivedCount?: number;
  expectedCount?: number;
  onClick: () => void;
}

export function ReceptionCard({
  retailerName,
  packageCount,
  completedAt,
  receptionStatus,
  receivedCount,
  expectedCount,
  onClick,
}: ReceptionCardProps) {
  const isInProgress = receptionStatus === 'reception_in_progress';

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {retailerName || 'Retailer desconocido'}
            </h3>
            {completedAt && (
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                <Clock className="h-3 w-3" />
                Retiro completado:{' '}
                {new Date(completedAt).toLocaleString('es-CL', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Package className="h-4 w-4" />
              <span>{packageCount}</span>
            </div>
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                isInProgress
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {isInProgress ? 'En progreso' : 'Pendiente'}
            </span>
          </div>
        </div>

        {isInProgress &&
          receivedCount !== undefined &&
          expectedCount !== undefined && (
            <div className="mt-2">
              <p className="text-sm text-blue-600 font-medium">
                En progreso: {receivedCount}/{expectedCount} recibidos
              </p>
              <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${expectedCount > 0 ? (receivedCount / expectedCount) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
