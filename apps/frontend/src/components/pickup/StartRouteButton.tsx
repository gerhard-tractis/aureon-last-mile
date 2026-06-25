'use client';

import { useState } from 'react';
import { Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface StartRouteButtonProps {
  disabled?: boolean;
  isSubmitting?: boolean;
  /** Receives optional vehicle label (free text) and triggers the mutation. */
  onStart: (vehicleLabel: string | null) => void;
}

/**
 * Primary CTA on the pickup landing when no route is active. Pops a small
 * dialog for an optional vehicle label and dispatches `onStart`. Spec keeps
 * vehicle as free text — no validation, no FK.
 */
export function StartRouteButton({
  disabled = false,
  isSubmitting = false,
  onStart,
}: StartRouteButtonProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');

  const handleConfirm = () => {
    onStart(label.trim() || null);
    setOpen(false);
    setLabel('');
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
          <div className="space-y-2">
            <label htmlFor="vehicle-label" className="text-sm text-text-secondary">
              Vehículo (opcional)
            </label>
            <Input
              id="vehicle-label"
              placeholder="Patente o alias"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm}>Iniciar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
