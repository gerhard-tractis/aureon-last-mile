'use client';

import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useCancelPickupRoute } from '@/hooks/pickup/useCancelPickupRoute';

/**
 * spec-61 Task 5 — the exit for a route that should never have been opened.
 *
 * Task 7 stopped `get_pending_manifests` offering routed loads, which is
 * right (two leaders collecting the same load is worse) but turned a missing
 * exit from cosmetic into load-bearing: a route opened by mistake, or one
 * whose manifests all failed to attach, holds its loads out of everyone
 * else's list indefinitely. `cancel_pickup_route` already existed; this is
 * the button and the confirm.
 *
 * The confirm is not decoration. This control sits next to "Cerrar ruta y
 * entregar", is reachable one-handed on a phone in a warehouse, and its
 * effect — the route-status trigger detaching every manifest and nulling
 * `reception_status` — is not visibly undoable from here. So it states both
 * consequences in words rather than leaving the leader to infer them.
 *
 * WHO MAY CANCEL: the route's own `driver_id`, or an operations_manager /
 * admin / super_admin — enforced by the RPC itself since migration
 * 20260821000001, and by the callers rendering this only for the route's own
 * leader. The client gate is defence in depth and keeps an elevated user from
 * being casually offered a destructive control on a route that is not theirs;
 * it is no longer the only thing standing there. See useCancelPickupRoute.ts.
 *
 * RENDERED IN TWO PLACES, on purpose: route/active (under "Cerrar ruta y
 * entregar") and 3h. `ActiveRouteBanner` — the only link to route/active
 * anywhere in the app — is rendered by PickupDesktopView, so below `lg` that
 * screen is reachable only in the moment right after the route is created. A
 * leader whose manifests all failed to attach navigates away once and can
 * never get back: exactly the abandoned-route case this exists to fix.
 */
export interface CancelRouteButtonProps {
  routeId: string;
  operatorId: string | null;
  /** Fired only after the RPC really succeeded. */
  onCancelled?: () => void;
}

export function CancelRouteButton({ routeId, operatorId, onCancelled }: CancelRouteButtonProps) {
  const [open, setOpen] = useState(false);
  const cancelMut = useCancelPickupRoute(operatorId);

  const handleConfirm = async () => {
    try {
      await cancelMut.mutateAsync({ routeId });
      setOpen(false);
      onCancelled?.();
    } catch (err) {
      // The route is still open and its loads are still locked away from
      // everyone else — say so rather than closing the dialog on a lie.
      toast.error(err instanceof Error ? err.message : 'No se pudo cancelar la ruta');
    }
  };

  return (
    <>
      {/* The hover pair on `className` is NOT optional. `variant="ghost"`
          carries `hover:bg-accent hover:text-accent-foreground`, and twMerge
          keeps both it and `text-status-error-text` -- so on hover the one
          destructive control on the screen turned brand-gold at 2.58:1 and
          lost its red entirely, exactly when the pointer was on it. */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="w-full gap-2 text-status-error-text hover:bg-status-error-bg hover:text-status-error-text"
        data-testid="cancel-route-button"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Cancelar ruta
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Cancelar esta ruta?</DialogTitle>
            <DialogDescription>
              Las cargas de esta ruta vuelven a la lista de pendientes y quedan disponibles para
              otro equipo. Lo que ya escaneaste en esta ruta deja de contar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirm()}
              disabled={cancelMut.isPending}
              className="gap-2"
            >
              {cancelMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Sí, cancelar la ruta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
