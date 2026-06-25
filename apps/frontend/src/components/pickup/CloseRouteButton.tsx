'use client';

import { Loader2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CloseRouteButtonProps {
  /** Total verified scans across all linked manifests. Disable when 0. */
  totalVerified: number;
  isSubmitting?: boolean;
  onClose: () => void;
}

/**
 * Bottom CTA on the active-route page. Disabled until at least one verified
 * scan exists across all linked manifests (server-side enforced too).
 */
export function CloseRouteButton({
  totalVerified,
  isSubmitting = false,
  onClose,
}: CloseRouteButtonProps) {
  const disabled = totalVerified === 0 || isSubmitting;
  return (
    <Button
      onClick={onClose}
      disabled={disabled}
      size="lg"
      className="w-full gap-2"
      data-testid="close-route-button"
    >
      {isSubmitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Truck className="h-4 w-4" />
      )}
      Cerrar ruta y entregar
    </Button>
  );
}
