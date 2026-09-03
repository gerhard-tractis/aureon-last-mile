'use client';

import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { LoadingMonitorRoute } from '@/hooks/dispatch/useLoadingMonitor';
import { formatFreshness, formatStaleness, computeLoadRateFmt, type LoadState } from '@/lib/dispatch/loading-monitor';
import { LOAD_STATE_LABEL } from '@/lib/dispatch/loading-monitor-labels';

interface Props {
  route: LoadingMonitorRoute;
  state: LoadState;
  /** Epoch ms, ticked by the parent (a single useNowTick drives every
   *  card's freshness text — rule 8: memo + a stable prop, not N intervals). */
  now: number;
  onNavigate: (routeId: string) => void;
  onDelete?: (routeId: string) => void;
}

function formatCloseTime(iso: string): string {
  // hour12: false pinned explicitly — Chile uses a 24h clock ("08:41"), and
  // leaving hour12 to the locale default is not reliable across ICU data
  // versions (observed rendering "a. m." in this repo's test environment).
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function pct(loaded: number, total: number): number {
  return total > 0 ? Math.round((loaded / total) * 100) : 0;
}

/** Kept from the RouteListTile this card replaces (rule 10 — don't
 *  silently drop a field): the plan date is still worth showing per card,
 *  the tab header's date is "today", not necessarily this route's date. */
function formatRouteDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
  });
}

/** Action button per state — "Ver carga" everywhere except LISTA PARA
 *  DESPACHO (rule 2: dispatching only offered on an already-`loaded`
 *  route) and BORRADOR (its own copy, per the design). None of the three
 *  build a duplicate vehicle/driver picker inline: the manager-typed
 *  truck_identifier that /dispatch requires has no persisted home before
 *  dispatch (routes.vehicle_id is written BY that endpoint, not before
 *  it — see useLoadingMonitor.ts) — so every action here opens the
 *  route's own detail screen, which already owns that form, rather than
 *  guessing at data this task was told not to invent.
 */
function actionLabel(state: LoadState): string {
  if (state === 'ready') return 'Despachar a DispatchTrack';
  if (state === 'draft') return 'Asignar cuadrilla y vehículo';
  return 'Ver carga';
}

export function LoadingRouteCard({ route, state, now, onNavigate, onDelete }: Props) {
  const config = LOAD_STATE_LABEL[state];
  const routeLabel = route.externalRouteId ?? route.id.slice(0, 8).toUpperCase();
  const canDelete = (route.status === 'draft' || route.status === 'planned') && !!onDelete;
  const outstanding = Math.max(0, route.packagesTotal - route.packagesLoaded);
  const rate = computeLoadRateFmt(route.packagesLoaded, route.firstScanAtIso, now);
  const driverLine = [route.driverName ?? 'Sin conductor', route.vehiclePlate, route.vehicleType]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid={`loading-route-card-${route.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(route.id)}
      // Target guard (rule 5): without `e.target === e.currentTarget`, Enter
      // pressed on a NESTED interactive child (the delete trigger, the
      // action button) bubbles up here too and double-fires navigation on
      // top of whatever the child itself does on Enter.
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onNavigate(route.id)}
      className={cn(
        'flex flex-col gap-3 rounded-xl border-[1.5px] border-border bg-surface p-4 transition-colors hover:bg-surface-raised cursor-pointer',
        state === 'stalled' && 'border-status-error-border bg-status-error-bg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-base font-bold text-accent">
          {routeLabel}
          <span className="ml-2 font-sans text-[11px] font-normal text-text-secondary">{formatRouteDate(route.routeDate)}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={state} label={config.label} variant={config.variant} size="sm" />
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-0.5 text-text-secondary hover:text-status-error transition-colors"
                  aria-label="Eliminar ruta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar ruta {routeLabel}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Los paquetes asignados volverán al estado <strong>sectorizado</strong>. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.stopPropagation(); onDelete?.(route.id); }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Freshness / staleness line — the whole point of this screen (rule
          9): recomputed from `now`, a prop the parent ticks, never a value
          captured once at mount. */}
      {state === 'loading' && route.lastScanAtIso && (
        <p className="text-xs text-text-secondary">último escaneo {formatFreshness(route.lastScanAtIso, now)}</p>
      )}
      {state === 'stalled' && route.lastScanAtIso && (
        <p className="text-xs font-medium text-status-error-text">sin escaneos {formatStaleness(route.lastScanAtIso, now)}</p>
      )}
      {state === 'ready' && (
        <p className="text-xs text-text-secondary">
          <span>cerrada</span>
          <span className="mx-1">·</span>
          <span>Cerró {formatCloseTime(route.updatedAtIso)}</span>
        </p>
      )}

      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-bold text-text">{route.packagesLoaded}</span>
        <span className="text-xs text-text-secondary">de {route.packagesTotal} paquetes</span>
        <span className="ml-auto text-xs font-semibold text-text-secondary">{pct(route.packagesLoaded, route.packagesTotal)} %</span>
      </div>

      {state === 'stalled' && (
        <p className="text-xs text-text-secondary">
          «La cuadrilla dejó de escanear. Nadie cerró la ruta y quedan {outstanding} paquetes en el andén.»
        </p>
      )}

      {state === 'draft' && !route.vehiclePlate && (
        <p className="text-xs font-medium text-status-warning-text">Sin vehículo asignado</p>
      )}

      {(state === 'loading' || state === 'stalled') && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          {route.loadPositionLabel && <span>{route.loadPositionLabel}</span>}
          {rate !== null && <span>{rate}/h</span>}
        </div>
      )}

      {(route.driverName || route.vehiclePlate) && (
        <p className="text-xs text-text-secondary">{driverLine}</p>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onNavigate(route.id); }}
        className="mt-1 self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 transition-opacity"
      >
        {actionLabel(state)}
      </button>
    </div>
  );
}
