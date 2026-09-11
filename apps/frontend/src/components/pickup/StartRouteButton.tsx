'use client';

import { useState } from 'react';
import { Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { VehicleSelect } from '@/components/pickup/VehicleSelect';

interface StartRouteButtonProps {
  operatorId: string | null;
  disabled?: boolean;
  isSubmitting?: boolean;
  /** Receives the selected `vehicles.id` and triggers the mutation. */
  onStart: (vehicleId: string) => void;
}

/**
 * Primary CTA on the pickup landing when no route is active. Pops a dialog
 * with one **required** field: the vehicle. A route carries an FK to the truck
 * that performed it, so there is no blank-vehicle path from the UI.
 */
export function StartRouteButton({
  operatorId,
  disabled = false,
  isSubmitting = false,
  onStart,
}: StartRouteButtonProps) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!vehicleId) return;
    onStart(vehicleId);
    setOpen(false);
    setVehicleId(null);
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
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
