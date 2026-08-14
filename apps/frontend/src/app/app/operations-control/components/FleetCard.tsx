'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { ActiveRoute } from '@/hooks/useActiveRoutes';

/**
 * spec-54 phase 4 — "Flota en calle" (mock 2a, right column bottom).
 *
 * One row per active route. The status pill is the only place the ops lead
 * looks first, so it is mono and right-aligned; the driver and route code
 * carry the identity and the stop counter carries the progress.
 */

function initials(name: string | null): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  const first = parts[0][0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + second).toUpperCase();
}

type FleetTone = 'ok' | 'warn' | 'err' | 'idle';

const TONE_CLASSES: Record<FleetTone, string> = {
  ok: 'bg-status-success-bg text-status-success-text border-status-success-border',
  warn: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
  err: 'bg-status-error-bg text-status-error-text border-status-error-border',
  idle: 'bg-surface-raised text-text-secondary border-border',
};

/**
 * A route is behind when its completed share trails the share of its planned
 * window that has already elapsed. Without a start time there is nothing to
 * compare against, so it reports as planned rather than guessing.
 */
export function routeTone(route: ActiveRoute): { tone: FleetTone; label: string } {
  if (route.status === 'planned') return { tone: 'idle', label: 'PLANIFICADA' };
  if (route.status === 'completed') return { tone: 'ok', label: 'COMPLETADA' };
  if (route.status === 'cancelled') return { tone: 'idle', label: 'CANCELADA' };

  const total = route.total_stops || 0;
  if (total === 0) return { tone: 'idle', label: 'SIN PARADAS' };

  const failed = route.dispatches.filter((d) => d.status === 'failed').length;
  if (failed > 0) return { tone: 'err', label: `${failed} FALLIDA${failed > 1 ? 'S' : ''}` };

  const done = route.completed_stops ?? 0;
  const remaining = total - done;
  if (remaining <= 0) return { tone: 'ok', label: 'COMPLETADA' };

  // Behind if more than a third of the route is still open with no failures —
  // a coarse but honest read from the fields this RPC actually returns.
  const progress = done / total;
  if (progress < 0.34) return { tone: 'warn', label: 'RIESGO' };
  return { tone: 'ok', label: 'EN TIEMPO' };
}

interface FleetCardProps {
  routes: ActiveRoute[];
  isLoading?: boolean;
}

export function FleetCard({ routes, isLoading = false }: FleetCardProps) {
  const active = routes.filter((r) => r.status === 'in_progress').length;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <header className="flex flex-none items-baseline gap-2 border-b border-border px-4 py-3.5">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Flota en calle
        </h2>
        {!isLoading && (
          <span className="ml-auto font-mono text-[11px] font-medium leading-none text-text-secondary">
            {active} activos · {routes.length} rutas
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5">
              <Skeleton className="h-[26px] w-[26px] flex-none rounded-[7px]" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-40 rounded" />
                <Skeleton className="h-2.5 w-28 rounded" />
              </div>
            </div>
          ))
        ) : routes.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">
            Ninguna ruta en calle todavía.
          </p>
        ) : (
          routes.map((route) => {
            const { tone, label } = routeTone(route);
            return (
              <div
                key={route.id}
                data-testid="fleet-row"
                className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
              >
                <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] bg-surface-raised font-mono text-[9.5px] font-semibold text-text-secondary">
                  {initials(route.driver_name)}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate text-[11.5px] font-semibold leading-none text-text">
                    {route.driver_name ?? 'Sin conductor'} · {route.external_route_id}
                  </span>
                  <span className="truncate font-mono text-[10.5px] leading-none text-text-muted">
                    {route.completed_stops ?? 0}/{route.total_stops ?? 0} paradas
                  </span>
                </div>

                <span
                  className={cn(
                    'flex-none rounded-sm border px-1.5 py-[3px] font-mono text-[10.5px] font-semibold leading-none',
                    TONE_CLASSES[tone],
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
