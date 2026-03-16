'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { CapacityAlert, useDismissAlert } from '@/hooks/useCapacityAlerts';

interface Props {
  alerts: CapacityAlert[];
  onClose: () => void;
}

function getSeverityClass(thresholdPct: number | null): string {
  if (thresholdPct === null) return 'bg-yellow-400';
  if (thresholdPct >= 120) return 'bg-red-500';
  if (thresholdPct >= 100) return 'bg-orange-500';
  return 'bg-yellow-400';
}

function getSeverityLabel(thresholdPct: number | null): string {
  if (thresholdPct === null) return 'yellow';
  if (thresholdPct >= 120) return 'red';
  if (thresholdPct >= 100) return 'orange';
  return 'yellow';
}

function formatDate(dateStr: string): string {
  // dateStr is YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

export default function CapacityAlertPanel({ alerts, onClose }: Props) {
  const router = useRouter();
  const { mutate: dismissAlert } = useDismissAlert();

  const visibleAlerts = alerts.slice(0, 10);

  return (
    <div
      className="absolute right-0 top-full mt-2 w-96 bg-card border border-border rounded-lg shadow-lg z-50"
      data-testid="capacity-alert-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Alertas de Capacidad</h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Cerrar panel"
        >
          ✕
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {visibleAlerts.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No hay alertas activas
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visibleAlerts.map((alert) => {
              const severityLabel = getSeverityLabel(alert.threshold_pct);
              const severityClass = getSeverityClass(alert.threshold_pct);

              return (
                <li key={alert.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    data-testid="severity-indicator"
                    className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${severityClass} ${severityLabel}`}
                    aria-label={`Severidad: ${severityLabel}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {alert.client_id ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {alert.actual_pct !== null ? `${alert.actual_pct}%` : '—'}{' '}
                      · {formatDate(alert.capacity_date)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        router.push('/app/capacity-planning');
                        onClose();
                      }}
                      className="text-xs text-primary-600 hover:underline"
                      aria-label="Ver"
                    >
                      Ver
                    </button>
                    <button
                      onClick={() => dismissAlert(alert.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Descartar"
                    >
                      Descartar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
