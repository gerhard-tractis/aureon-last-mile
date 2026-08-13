'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useReopenRouteReception } from '@/hooks/reception/useReopenRouteReception';

interface ReopenRouteButtonProps {
  routeId: string;
  code: string;
  /** Packages already scanned into this batch. Any at all hides the button. */
  receivedCount: number;
}

/**
 * Recovery path for a reception opened by mistake — a QR scanned before the
 * truck was really at the hub. Without it the driver stays locked out of
 * pickup scanning for the rest of the shift, and the route cannot even be
 * cancelled to free the vehicle.
 *
 * Only offered while the batch is untouched. Once a single package has been
 * received, rewinding would orphan those scans; the correct move is to finish
 * the reception and record the discrepancy, which is what the server enforces.
 *
 * `reopen_pickup_route` also raises a *named* Spanish error when the driver has
 * already started a replacement route — the likely case, since being locked out
 * is exactly why a reopen gets attempted — so the message is shown verbatim.
 */
export function ReopenRouteButton({
  routeId,
  code,
  receivedCount,
}: ReopenRouteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reopen = useReopenRouteReception();

  if (receivedCount > 0) return null;

  const handleConfirm = () => {
    setErrorMessage(null);
    reopen.mutate(
      { routeId },
      {
        onSuccess: () => {
          setOpen(false);
          router.push('/app/reception');
        },
        onError: (error: Error) => {
          setErrorMessage(error.message || 'No se pudo reabrir la ruta');
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="w-full gap-2 text-text-secondary"
        onClick={() => {
          setErrorMessage(null);
          setOpen(true);
        }}
      >
        <Undo2 className="h-4 w-4" />
        Reabrir ruta (abierta por error)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reabrir la ruta</DialogTitle>
            <DialogDescription>
              La ruta <strong className="font-mono">{code}</strong> volverá a
              estado &quot;en retiro&quot; y el chofer podrá seguir escaneando.
              Solo es posible mientras no se haya recibido ningún paquete.
            </DialogDescription>
          </DialogHeader>

          {errorMessage && (
            <p
              role="alert"
              className="rounded-lg bg-status-error-bg p-3 text-sm text-status-error"
            >
              {errorMessage}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={reopen.isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={reopen.isPending} className="gap-2">
              {reopen.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar reapertura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
