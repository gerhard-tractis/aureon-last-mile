import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';
import type { BadgeVariant } from '@/components/StatusBadge';
import type { DispatchRoute, RouteStatus } from '@/lib/dispatch/types';

interface Props {
  route: DispatchRoute;
  onClick: () => void;
}

const ROUTE_STATUS_CONFIG: Record<RouteStatus, { label: string; variant: BadgeVariant }> = {
  draft:       { label: 'Borrador',    variant: 'neutral' },
  planned:     { label: 'Planificada', variant: 'info' },
  in_progress: { label: 'En ruta',     variant: 'warning' },
  completed:   { label: 'Completada',  variant: 'success' },
  cancelled:   { label: 'Cancelada',   variant: 'error' },
};

function isOverdue(routeDate: string, status: RouteStatus): boolean {
  if (status !== 'draft' && status !== 'planned') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(routeDate + 'T00:00:00');
  return date < today;
}

function formatRouteDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-CL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatCreationTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RouteListTile({ route, onClick }: Props) {
  const statusConfig = ROUTE_STATUS_CONFIG[route.status];
  const overdue = isOverdue(route.route_date, route.status);

  const routeLabel = route.external_route_id ?? route.id.slice(0, 8).toUpperCase();

  const progressPct =
    route.planned_stops > 0
      ? Math.round((route.completed_stops / route.planned_stops) * 10000) / 100
      : 0;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        'flex min-h-[130px] cursor-pointer flex-col justify-between rounded-xl border-[1.5px] border-border bg-surface p-4 transition-colors hover:bg-surface-raised',
        overdue && 'border-status-warning-border bg-status-warning-bg',
      )}
    >
      {/* Header row: route ID + status badge */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-base font-bold text-accent">
          {routeLabel}
        </span>
        <StatusBadge
          status={statusConfig.label}
          variant={statusConfig.variant}
          size="sm"
        />
      </div>

      {/* Middle row: driver + truck */}
      <p className="mt-1 text-xs text-text-secondary">
        {route.driver_name ?? 'Sin conductor'}
        {route.truck_identifier && (
          <>
            {' \u00b7 Cami\u00f3n '}
            {route.truck_identifier}
          </>
        )}
      </p>

      {/* Footer row: progress bar + stats + date */}
      <div className="mt-3 flex flex-col gap-1.5">
        {/* Progress bar */}
        <div
          role="progressbar"
          aria-valuenow={route.completed_stops}
          aria-valuemin={0}
          aria-valuemax={route.planned_stops}
          className="h-1.5 w-full rounded-full bg-surface-raised"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-bold text-text">
            {route.completed_stops}/{route.planned_stops}{' '}
            <span className="text-xs font-normal text-text-secondary">
              paquetes
            </span>
          </span>
          <span className="text-[11px] text-text-secondary">
            {formatRouteDate(route.route_date)}
            {' \u00b7 '}
            {formatCreationTime(route.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
