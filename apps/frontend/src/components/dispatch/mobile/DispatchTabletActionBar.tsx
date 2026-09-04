'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/button';
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
import { CLOSE_ROUTE_DISABLED_REASON } from '@/lib/dispatch/mobile/close-route-copy';
import { refocusPackageField } from '@/lib/scan/refocus-package-field';

export interface DispatchTabletActionBarProps {
  packagesLoaded: number;
  /** true only once the endpoint's own precondition (`status === 'loaded'`)
   *  and a real vehicle assignment both hold — see this component's own
   *  header comment for why this can never be true yet on this branch. */
  canDispatch: boolean;
  dispatchDisabledReason: string | null;
  dispatching: boolean;
  dispatchError: string | null;
  onDispatch: () => void;
}

const CLOSE_REASON_ID = 'dispatch-tablet-close-route-reason';
const DISPATCH_REASON_ID = 'dispatch-tablet-dispatch-reason';

/**
 * spec-78 (`3a`) decision 3 — both terminal actions, full confirmations,
 * neither simplified because there is room on a bigger screen: an
 * accidental touch on a shared, mounted tablet is a real risk.
 *
 * *Cerrar ruta* stays disabled with its reason as visible text (2i is
 * spec-77, `Status: backlog`) — the exact convention 2e already uses
 * (`CLOSE_ROUTE_DISABLED_REASON`, shared so the two surfaces never say two
 * different things about the same missing screen).
 *
 * *Despachar a DispatchTrack* is genuinely wired to the real endpoint
 * (`POST /api/dispatch/routes/[id]/dispatch`, the same one desktop's
 * `RouteBuilder`/`RoutePanel` calls, via the shared
 * `useDispatchRouteToDispatchTrack` hook — spec-78 review I1) with a full
 * confirmation dialog of its own — "live", not "not built". Its actual
 * precondition (`route.status === 'loaded'`) genuinely cannot be reached
 * from this screen yet: reaching `loaded` requires sealing the route
 * first (2i, spec-77), and 2i doesn't exist. So the button renders
 * correctly disabled today, for an honest reason, and starts working the
 * moment spec-77 ships — no further change needed here.
 *
 * spec-78 review I2 — cancelling the confirmation returns focus to this
 * trigger button (Radix's default), and `refocusPackageField()` normally
 * only runs after a scan RESULT (`useRouteScanSession`'s own
 * onSuccess/onError) — a cancelled dialog produces neither. Without the
 * `onOpenChange` below, the very next Zebra trigger-pull types into this
 * button and the read is silently dropped, on a device with no on-screen
 * confirmation that anything went wrong: the exact failure mode
 * `refocus-package-field.ts`'s own header documents (spec-71 QA), new
 * here because 2e's Cerrar ruta has no dialog to cancel out of.
 *
 * spec-78 review I3 — `memo`'d: every accepted/rejected scan re-renders
 * the parent (`useRouteScanSession`'s `history`), but this bar's own
 * props only change on a dispatch attempt or a route-status refetch.
 */
function DispatchTabletActionBarImpl({
  packagesLoaded,
  canDispatch,
  dispatchDisabledReason,
  dispatching,
  dispatchError,
  onDispatch,
}: DispatchTabletActionBarProps) {
  return (
    <footer className="flex flex-col gap-2 border-t border-border bg-surface px-5 py-3">
      {dispatchError && (
        <p className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-text">
          {dispatchError}
        </p>
      )}
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Button
            variant="outline"
            className="h-14 w-full rounded-[10px] text-[14px] font-semibold"
            disabled
            aria-describedby={CLOSE_REASON_ID}
          >
            Cerrar ruta
          </Button>
          <p id={CLOSE_REASON_ID} className="text-center text-[11px] text-text-muted">
            {CLOSE_ROUTE_DISABLED_REASON}
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <AlertDialog onOpenChange={(open) => { if (!open) refocusPackageField(); }}>
            <AlertDialogTrigger asChild>
              <Button
                className="h-14 w-full rounded-[10px] text-[14px] font-bold"
                disabled={!canDispatch || dispatching}
                aria-describedby={!canDispatch && dispatchDisabledReason ? DISPATCH_REASON_ID : undefined}
              >
                {dispatching ? 'Despachando…' : 'Despachar a DispatchTrack'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar despacho</AlertDialogTitle>
                <AlertDialogDescription>
                  Se enviará la ruta con {packagesLoaded} paquetes a DispatchTrack. Esta acción no se puede
                  deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDispatch}>Despachar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {!canDispatch && dispatchDisabledReason && (
            <p id={DISPATCH_REASON_ID} className="text-center text-[11px] text-text-muted">
              {dispatchDisabledReason}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}

export const DispatchTabletActionBar = memo(DispatchTabletActionBarImpl);
