'use client';

import { memo } from 'react';
import { Trash2, ArrowRight } from 'lucide-react';
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
import type { LoadingMonitorRoute, CrewMember } from '@/hooks/dispatch/useLoadingMonitor';
import { computeLoadRateFmt, isRouteOverdue, type LoadState } from '@/lib/dispatch/loading-monitor';
import { LOAD_STATE_LABEL } from '@/lib/dispatch/loading-monitor-labels';
import { ScanFreshness } from './ScanFreshness';

interface Props {
  route: LoadingMonitorRoute;
  state: LoadState;
  /** Epoch ms, ticked SLOWLY by the parent (I4 review — this is no longer
   *  the 1s tick; that lives inside <ScanFreshness> now, the only thing on
   *  this card that needs second-precision). Used here only for the rate
   *  figure and nothing else time-sensitive. */
  now: number;
  /** `todayISOInTimezone()`, resolved once by the parent per render batch
   *  — not recomputed per card (I1/I2). */
  today: string;
  /** This route's own scanning crew (M1 review) — pre-filtered by the
   *  parent from the full crew list, not fetched again here. */
  crew: CrewMember[];
  onNavigate: (routeId: string) => void;
  onDelete?: (routeId: string) => void;
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

/**
 * Minor review item — `createEmptyDraft` mints a placeholder
 * `external_route_id` like `draft_3f9c8e21…` before a real DispatchTrack id
 * exists. Showing that raw slug as the card's headline reads as a bug, not
 * a route name; the route's own short id is what every OTHER state already
 * falls back to when there is no external id at all, so an unresolved
 * draft slug gets the same short-id treatment instead of a third format.
 */
function routeLabelOf(route: LoadingMonitorRoute): string {
  if (route.externalRouteId && !route.externalRouteId.startsWith('draft_')) {
    return route.externalRouteId;
  }
  return route.id.slice(0, 8).toUpperCase();
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

function LoadingRouteCardImpl({ route, state, now, today, crew, onNavigate, onDelete }: Props) {
  const config = LOAD_STATE_LABEL[state];
  const routeLabel = routeLabelOf(route);
  const canDelete = (route.status === 'draft' || route.status === 'planned') && !!onDelete;
  const outstanding = Math.max(0, route.packagesTotal - route.packagesLoaded);
  const rate = computeLoadRateFmt(route.packagesLoaded, route.firstScanAtIso, now);
  const overdue = isRouteOverdue(route.routeDate, today);
  const anden = route.loadPositionLabel ?? route.loadPositionCode;
  const isDispatchAction = state === 'ready';

  return (
    // C2 review — this used to be `role="button"`/`tabIndex`/`onKeyDown`,
    // wrapping the delete trigger AND the action button. A `role="button"`
    // wrapper takes its accessible name from ALL its content (so the whole
    // card announced as one button reading every stat on it) and a
    // `button` role forbids interactive descendants, making the REAL
    // buttons unreachable to assistive tech — jsdom doesn't enforce either
    // rule, which is why the earlier version's tests passed anyway. The
    // click here is a bare mouse convenience now; the two real `<button>`
    // children below carry all keyboard/AT semantics on their own.
    <div
      data-testid={`loading-route-card-${route.id}`}
      onClick={() => onNavigate(route.id)}
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
          {/* I2 review — orthogonal to `state`: a route can be both
              overdue AND stalled (or overdue and healthily loading). Amber
              warning tokens, deliberately distinct from the stalled
              card's error-toned border, so the two signals compose
              instead of one masking the other. */}
          {overdue && <StatusBadge status="overdue" label="Atrasada" variant="warning" size="sm" />}
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

      {/* I4 review — <ScanFreshness> owns its own 1s tick; this is the
          ONLY subtree on the tab that re-renders every second. */}
      {(state === 'loading' || state === 'stalled') && route.lastScanAtIso && (
        <ScanFreshness lastScanAtIso={route.lastScanAtIso} stalled={state === 'stalled'} />
      )}
      {state === 'ready' && (
        // C1 review — dropped the close time entirely. `routes.updated_at`
        // is NOT reliably "when this route sealed": sweep_load_position_
        // assignments (20260827000003) also writes it, best-effort, after
        // EVERY successful dispatch of any OTHER route on this operator,
        // whenever it frees up a position this route was waiting on — so a
        // route sealed at 08:41 can read a bumped `updated_at` hours later
        // with no seal-related event at all. There is no dedicated
        // sealed_at/closed_at column to read instead (only `status` plus
        // the generic updated_at trigger), so "cerrada" alone is what's
        // actually known — a proxy timestamp under a label that asserts a
        // fact is worse than no timestamp.
        <p className="text-xs text-text-secondary">cerrada</p>
      )}

      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-bold text-text">{route.packagesLoaded}</span>
        <span className="text-xs text-text-secondary">de {route.packagesTotal} paquetes</span>
        <span className="ml-auto text-xs font-semibold text-text-secondary">{pct(route.packagesLoaded, route.packagesTotal)} %</span>
      </div>

      {state === 'stalled' && (
        <p className="text-xs text-text-secondary">
          La cuadrilla dejó de escanear. Nadie cerró la ruta y quedan {outstanding} paquetes en el andén.
        </p>
      )}

      {state === 'draft' && (
        <p className="text-xs font-medium text-status-warning-text">Sin vehículo asignado</p>
      )}

      {(state === 'loading' || state === 'stalled') && (anden || rate !== null || crew.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          {anden && <span>{anden}</span>}
          {rate !== null && <span>{rate}/h</span>}
          {/* M1 review — the crew actually scanning this route, by name.
              There is no shift/turno concept anywhere in the schema (see
              ActiveCrewPanel's header comment), so real names are what
              this row can honestly show. */}
          {crew.length > 0 && <span>{crew.map((c) => c.fullName).join(', ')}</span>}
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onNavigate(route.id); }}
        // Minor review — "Despachar a DispatchTrack" reads as a one-click
        // dispatch, but it only opens the route's detail screen (see the
        // header comment above `actionLabel`). The arrow + aria-description
        // make that a step, not an instant action, without changing the
        // required label text itself.
        aria-description={isDispatchAction ? 'Abre la pantalla de la ruta para completar el despacho' : undefined}
        className="mt-1 flex items-center gap-1 self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 transition-opacity"
      >
        {actionLabel(state)}
        {isDispatchAction && <ArrowRight className="h-3 w-3" />}
      </button>
    </div>
  );
}

export const LoadingRouteCard = memo(LoadingRouteCardImpl);
