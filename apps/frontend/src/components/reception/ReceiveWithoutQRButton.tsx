'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOpenRouteReception } from '@/hooks/reception/useOpenRouteReception';

interface ReceiveWithoutQRButtonProps {
  routeId: string;
  code: string;
  plate: string | null;
}

/**
 * Manual fallback for a damaged or unscannable QR — the only way besides a
 * scan to open a reception.
 *
 * The confirmation dialog is not decoration. This action ends the driver's
 * trip: it stamps the arrival, freezes `expected_count` at whatever has been
 * scanned so far and locks the route against further pickup scans. Naming the
 * route code and the plate forces the receptionist to check the truck in front
 * of them against the row they tapped before any of that happens.
 */
export function ReceiveWithoutQRButton({
  routeId,
  code,
  plate,
}: ReceiveWithoutQRButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const openReception = useOpenRouteReception();

  const handleConfirm = () => {
    setErrorMessage(null);
    openReception.mutate(
      { routeId },
      {
        onSuccess: () => {
          setOpen(false);
          router.push(`/app/reception/route/${routeId}`);
        },
        onError: (error: Error) => {
          setErrorMessage(error.message || 'No se pudo abrir la recepción');
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => {
          setErrorMessage(null);
          setOpen(true);
        }}
      >
        <PackageCheck className="h-4 w-4" />
        Recibir sin QR
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar llegada al hub</DialogTitle>
            <DialogDescription>
              Vas a abrir la recepción de la ruta{' '}
              <strong className="font-mono">{code}</strong>, patente{' '}
              <strong className="font-mono">{plate ?? 'Sin patente'}</strong>. El
              chofer ya no podrá seguir escaneando retiros en esta ruta.
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
              disabled={openReception.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={openReception.isPending}
              className="gap-2"
            >
              {openReception.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Confirmar recepción
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
