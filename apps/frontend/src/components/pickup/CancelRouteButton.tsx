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
 * WHO MAY CANCEL: the caller renders this only for the route's own leader.
 * That gate is CLIENT-SIDE ONLY — `cancel_pickup_route` checks the operator
 * and nothing else. See useCancelPickupRoute.ts for the full note.
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
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="w-full gap-2 text-status-error-text"
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
