'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

/**
 * spec-54 phase 4.5 — the route column on Recepción (mock 1e, left).
 *
 * The mock's tabs read Entrantes / Retornos / Cerradas. Retornos are return
 * *routes* — a different entity with its own session flow — so folding them
 * into this switcher would change what the column navigates, not just how it
 * looks. The tabs here are the three states an inbound route actually has,
 * which is what the reception landing already models.
 */

export type RouteTab = 'incoming' | 'unloading' | 'closed';

export const ROUTE_TABS: { key: RouteTab; label: string }[] = [
  { key: 'incoming', label: 'Entrantes' },
  { key: 'unloading', label: 'En descarga' },
  { key: 'closed', label: 'Cerradas' },
];

interface RouteSwitcherColumnProps {
  tab: RouteTab;
  onTabChange: (tab: RouteTab) => void;
  routes: IncomingRoute[];
  counts: Record<RouteTab, number>;
  /** The route whose session is open, if any. */
  activeRouteId?: string | null;
  /**
   * Counted-so-far for the OPEN route only. useIncomingRoutes returns
   * expected_packages but no received count, so a progress bar on the other
   * rows would be invented — they show their expected total instead.
   */
  activeProgress?: { received: number; expected: number } | null;
  isLoading?: boolean;
}

export function RouteSwitcherColumn({
  tab,
  onTabChange,
  routes,
  counts,
  activeRouteId = null,
  activeProgress = null,
  isLoading = false,
}: RouteSwitcherColumnProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <div className="flex flex-none flex-wrap gap-1 border-b border-border px-3 py-3">
        {ROUTE_TABS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={tab === option.key}
            onClick={() => onTabChange(option.key)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-[11px] leading-none transition-colors',
              tab === option.key
                ? 'bg-surface-raised font-semibold text-text'
                : 'text-text-secondary hover:bg-surface-raised',
            )}
          >
            {option.label} {counts[option.key]}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-text-secondary">Cargando…</p>
        ) : routes.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-text-secondary">
            {tab === 'incoming'
              ? 'Ninguna ruta en camino.'
              : tab === 'unloading'
                ? 'Ninguna ruta en descarga.'
                : 'Ninguna ruta cerrada todavía.'}
          </p>
        ) : (
          routes.map((route) => {
            const active = route.id === activeRouteId;
            const expected = route.expected_packages ?? 0;
            const progress = active ? activeProgress : null;
            const pct =
              progress && progress.expected > 0
                ? Math.min(100, (progress.received / progress.expected) * 100)
                : 0;

            return (
              <Link
                key={route.id}
                href={`/app/reception/route/${route.id}`}
                data-testid="route-option"
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col gap-1.5 border-b border-l-[3px] border-border-subtle px-3.5 py-3 transition-colors',
                  active
                    ? 'border-l-accent bg-accent-muted'
                    : 'border-l-transparent hover:bg-surface-raised',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12.5px] font-semibold leading-none text-text">
                    {route.code}
                  </span>
                  {active && (
                    <span className="ml-auto flex-none rounded border border-status-warning-border bg-status-warning-bg px-1.5 py-[3px] font-mono text-[9.5px] font-semibold leading-none text-accent">
                      EN CURSO
                    </span>
                  )}
                </div>

                <span className="truncate text-[11px] leading-none text-text-secondary">
                  {route.driver_name ?? 'Sin conductor'} · {route.manifest_count}{' '}
                  {route.manifest_count === 1 ? 'manifiesto' : 'manifiestos'}
                </span>

                {progress ? (
                  <div className="flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-valuenow={progress.received}
                      aria-valuemin={0}
                      aria-valuemax={progress.expected}
                      aria-label={`Conteo de ${route.code}`}
                      className="h-[5px] flex-1 overflow-hidden rounded-sm bg-surface-raised"
                    >
                      <span
                        data-testid={`route-progress-${route.id}`}
                        className="block h-full rounded-sm bg-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="flex-none font-mono text-[10.5px] font-semibold leading-none text-text-secondary">
                      {progress.received}/{progress.expected}
                    </span>
                  </div>
                ) : (
                  expected > 0 && (
                    <span className="font-mono text-[10.5px] leading-none text-text-muted">
                      {expected} paquetes esperados
                    </span>
                  )
                )}
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
