'use client';

import { useState } from 'react';
import { Loader2, PlayCircle, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { VehicleSelect } from '@/components/pickup/VehicleSelect';

interface StartRouteButtonProps {
  operatorId: string | null;
  disabled?: boolean;
  isSubmitting?: boolean;
  /**
   * Receives the selected `vehicles.id` and triggers the mutation. The
   * second argument is `true` only when the driver opened the dialog from
   * the secondary "Ver QR de la ruta" CTA (spec-95 fase 8, mock
   * `5a:224-225`) — no route exists yet at this point, so that button has
   * to create one too; it just tells the caller to land on the route's QR
   * page afterwards instead of the active-route screen.
   */
  onStart: (vehicleId: string, viewQr?: boolean) => void;
}

/**
 * Primary CTA on the pickup landing when no route is active. Pops a dialog
 * with one **required** field: the vehicle. A route carries an FK to the truck
 * that performed it, so there is no blank-vehicle path from the UI.
 *
 * spec-95 fase 8 — a secondary "Ver QR de la ruta" CTA shares this same
 * dialog rather than getting its own dead button: `PickupRouteDraftPanel`
 * only reaches this branch while the route is still a draft, so there is no
 * QR to show yet either way. Both buttons open the identical vehicle
 * picker; only the post-confirm destination differs, decided by the caller
 * via `onStart`'s second argument.
 */
export function StartRouteButton({
  operatorId,
  disabled = false,
  isSubmitting = false,
  onStart,
}: StartRouteButtonProps) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [qrIntent, setQrIntent] = useState(false);

  const openDialog = (viewQr: boolean) => {
    setQrIntent(viewQr);
    setOpen(true);
  };

  const handleConfirm = () => {
    if (!vehicleId) return;
    if (qrIntent) onStart(vehicleId, true);
    else onStart(vehicleId);
    setOpen(false);
    setVehicleId(null);
    setQrIntent(false);
  };

  return (
    <>
      <Button
        onClick={() => openDialog(false)}
        disabled={disabled || isSubmitting}
        size="lg"
        className="w-full gap-2"
        data-testid="start-route-button"
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        Iniciar ruta de retiro
      </Button>

      <Button
        onClick={() => openDialog(true)}
        disabled={disabled || isSubmitting}
        variant="outline"
        className="w-full gap-2"
        data-testid="view-route-qr-button"
      >
        <QrCode className="h-4 w-4" />
        Ver QR de la ruta
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Iniciar ruta de retiro</DialogTitle>
          </DialogHeader>
          <VehicleSelect
            operatorId={operatorId}
            value={vehicleId}
            onChange={setVehicleId}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={!vehicleId}>
              Iniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
