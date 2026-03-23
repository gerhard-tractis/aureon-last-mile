'use client';

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
    <div
      className="bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-accent/50 transition-colors min-h-[72px] flex flex-col justify-center"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text truncate">
            {retailerName || 'Retailer desconocido'}
          </h3>
          {completedAt && (
            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
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
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 text-sm text-text-secondary">
            <Package className="h-4 w-4" />
            <span className="font-mono">{packageCount}</span>
          </div>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              isInProgress
                ? 'bg-status-info-bg text-status-info'
                : 'bg-status-warning-bg text-status-warning'
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
            <p className="font-mono text-sm text-text-secondary">
              {receivedCount} / {expectedCount} recibidos
            </p>
            <div className="w-full bg-border rounded-full h-1.5 mt-1">
              <div
                className="bg-accent h-1.5 rounded-full transition-all"
                style={{
                  width: `${expectedCount > 0 ? (receivedCount / expectedCount) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
    </div>
  );
}
