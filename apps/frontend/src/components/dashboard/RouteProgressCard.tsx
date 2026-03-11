'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Truck } from 'lucide-react';
import type { ActiveRoute, ActiveDispatch } from '@/hooks/useActiveRoutes';

interface RouteProgressCardProps {
  route: ActiveRoute;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: ActiveRoute['status'] }) {
  const map: Record<ActiveRoute['status'], { label: string; className: string }> = {
    in_progress: { label: 'En Ruta', className: 'bg-blue-100 text-blue-700' },
    completed: { label: 'Completado', className: 'bg-emerald-100 text-emerald-700' },
    planned: { label: 'Planificado', className: 'bg-slate-100 text-slate-600' },
    cancelled: { label: 'Cancelado', className: 'bg-red-100 text-red-700' },
  };
  const { label, className } = map[status] ?? map.planned;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function DispatchStatusDot({ status }: { status: ActiveDispatch['status'] }) {
  const colors: Record<ActiveDispatch['status'], string> = {
    delivered: 'bg-emerald-500',
    failed: 'bg-red-500',
    partial: 'bg-amber-500',
    pending: 'bg-slate-300',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
}

function StopList({ dispatches }: { dispatches: ActiveDispatch[] }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 space-y-1" data-testid="stop-list">
      {dispatches.map((d, i) => (
        <div key={d.id} className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-5 text-right text-slate-400 shrink-0">
            {d.planned_sequence ?? i + 1}.
          </span>
          <DispatchStatusDot status={d.status} />
          <span className="flex-1 truncate">
            {d.order_id ? `Orden ${d.order_id.slice(0, 8)}…` : `Parada ${d.planned_sequence ?? i + 1}`}
          </span>
          {d.estimated_at && (
            <span className="text-slate-400 shrink-0">ETA {formatTime(d.estimated_at)}</span>
          )}
          {d.arrived_at && (
            <span className="text-emerald-600 shrink-0">✓ {formatTime(d.arrived_at)}</span>
          )}
        </div>
      ))}
      {dispatches.length === 0 && (
        <p className="text-xs text-slate-400 py-1">Sin paradas registradas</p>
      )}
    </div>
  );
}

export default function RouteProgressCard({ route }: RouteProgressCardProps) {
  const [expanded, setExpanded] = useState(false);

  const progress =
    route.total_stops > 0
      ? Math.round((route.completed_stops / route.total_stops) * 100)
      : 0;

  const nextStop = route.dispatches.find(d => d.status === 'pending');

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-4"
      data-testid="route-progress-card"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Truck className="h-4 w-4 text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-800 truncate" data-testid="driver-name">
            {route.driver_name ?? 'Conductor desconocido'}
          </span>
        </div>
        <StatusBadge status={route.status} />
      </div>

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span data-testid="progress-label">
            {route.completed_stops} de {route.total_stops} paradas
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
            data-testid="progress-bar"
          />
        </div>
      </div>

      {/* Next stop ETA */}
      {nextStop?.estimated_at && (
        <p className="text-xs text-slate-500 mb-3" data-testid="next-stop-eta">
          Próxima parada: ETA {formatTime(nextStop.estimated_at)}
        </p>
      )}

      {/* Expand/collapse */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3 w-3" /> Ocultar paradas
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" /> Ver {route.dispatches.length} paradas
          </>
        )}
      </button>

      {expanded && <StopList dispatches={route.dispatches} />}
    </div>
  );
}
