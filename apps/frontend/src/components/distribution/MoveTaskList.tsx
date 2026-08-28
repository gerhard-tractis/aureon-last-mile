import { TriangleAlert, PackageX } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import type { MoveTaskRoute, MoveTaskUnassignedRoute } from '@/lib/types';

/**
 * spec-71 phase 5 — the move-task picker's list.
 *
 * Pure presentation over `get_move_task_snapshot`. One card per route
 * holding a load position, its remaining packages grouped by the andén
 * they currently sit in (Decision 7 — each row is a real andén->position
 * hop, ordered biggest-first by the SQL function). The two states the spec
 * calls out as currently invisible are rendered inline, not on a separate
 * screen:
 *   - offset_conflict: a banner on the route card itself (Decision 7).
 *   - unassigned routes: their own "Sin posición" section below the list
 *     (Decision 8 — best-effort assignment can leave a route with none).
 */

function RouteCard({ route }: { route: MoveTaskRoute }) {
  return (
    <div
      data-testid={`move-task-route-${route.route_id}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate font-heading text-[15px] font-semibold text-text">
          Ruta {route.external_route_id}
          <span className="text-text-secondary"> → {route.load_position_code}</span>
        </p>
      </div>
      {route.load_position_label && (
        <p className="-mt-2 text-[12px] text-text-secondary">{route.load_position_label}</p>
      )}

      {route.offset_conflict && (
        <div
          data-testid={`move-task-conflict-${route.route_id}`}
          className="flex items-start gap-2 rounded-lg border border-status-error-border bg-status-error-bg p-3"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-status-error-text" aria-hidden="true" />
          <p className="text-[12.5px] font-medium text-status-error-text">
            Esta posición ahora está frente a un andén del que la ruta aún recibe paquetes.
            Reasigna la posición antes de seguir.
          </p>
        </div>
      )}

      <p className="font-mono text-[13px] font-semibold text-text">
        Faltan {route.remaining_packages} de {route.total_packages}
      </p>

      {route.groups.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {route.groups.map((group) => (
            <li
              key={`${route.route_id}-${group.dock_zone_id ?? 'sin-anden'}`}
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2"
            >
              <span className="min-w-0 truncate text-[13.5px] text-text">
                {group.is_retired
                  ? 'Andén eliminado'
                  : (group.dock_zone_code ?? group.dock_zone_name ?? 'Sin andén')}
              </span>
              <span className="flex-none whitespace-nowrap font-mono text-[13px] text-text-secondary">
                {group.remaining_count} {group.remaining_count === 1 ? 'paquete' : 'paquetes'} → {route.load_position_code}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnassignedRouteRow({ route }: { route: MoveTaskUnassignedRoute }) {
  return (
    <li
      data-testid={`move-task-unassigned-${route.route_id}`}
      className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2"
    >
      <span className="min-w-0 truncate text-[13.5px] text-text">Ruta {route.external_route_id}</span>
      <span className="flex-none whitespace-nowrap font-mono text-[12px] text-text-secondary">
        {route.total_packages} {route.total_packages === 1 ? 'paquete' : 'paquetes'} · sin posición
      </span>
    </li>
  );
}

export interface MoveTaskListProps {
  routes: MoveTaskRoute[];
  unassignedRoutes: MoveTaskUnassignedRoute[];
}

export function MoveTaskList({ routes, unassignedRoutes }: MoveTaskListProps) {
  if (routes.length === 0 && unassignedRoutes.length === 0) {
    return (
      <EmptyState
        icon={PackageX}
        title="Nada por mover"
        description="No hay paquetes pendientes de mover a una posición de carga en este momento."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {routes.length > 0 && (
        <div className="flex flex-col gap-3">
          {routes.map((route) => (
            <RouteCard key={route.route_id} route={route} />
          ))}
        </div>
      )}

      {unassignedRoutes.length > 0 && (
        <section
          data-testid="move-task-unassigned-section"
          className="flex flex-col gap-2 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5"
        >
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 flex-none text-status-warning-text" aria-hidden="true" />
            <p className="text-[13px] font-semibold text-status-warning-text">
              {unassignedRoutes.length}{' '}
              {unassignedRoutes.length === 1
                ? 'ruta sin posición de carga asignada'
                : 'rutas sin posición de carga asignada'}
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {unassignedRoutes.map((route) => (
              <UnassignedRouteRow key={route.route_id} route={route} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
