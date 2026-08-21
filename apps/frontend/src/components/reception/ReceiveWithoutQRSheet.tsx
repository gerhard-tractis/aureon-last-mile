'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ReceptionMobileCompactRow } from './ReceptionMobileCompactRow';
import { ReceiveWithoutQRButton } from './ReceiveWithoutQRButton';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

interface ReceiveWithoutQRSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: IncomingRoute[];
}

/**
 * spec-62 3i — the manual fallback for a damaged QR has no route context by
 * default (the yard footer isn't looking at any one truck), so this sheet's
 * whole job is letting the receptionist pick the truck first.
 *
 * It never opens a reception itself: picking a route only swaps the row
 * list for `ReceiveWithoutQRButton`, which owns the confirmation dialog and
 * the `open_route_reception` mutation. That RPC ends the driver's trip, so
 * it must only ever fire from that button's own confirmed click — never as
 * a side effect of rendering or choosing a row here.
 */
export function ReceiveWithoutQRSheet({
  open,
  onOpenChange,
  routes,
}: ReceiveWithoutQRSheetProps) {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset the pick so re-opening the sheet always starts at the list,
      // not mid-confirmation on whatever route was chosen last time.
      setSelectedRouteId(null);
    }
    onOpenChange(next);
  };

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Recibir sin QR</SheetTitle>
          <SheetDescription>
            Elegí la ruta cuyo camión está frente a vos.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-2">
          {selectedRoute ? (
            <ReceiveWithoutQRButton
              routeId={selectedRoute.id}
              code={selectedRoute.code}
              plate={selectedRoute.plate}
            />
          ) : routes.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              Ninguna ruta en camino todavía.
            </p>
          ) : (
            routes.map((route) => (
              // `ReceptionMobileCompactRow` (Task 10) doesn't render the
              // plate — its yard-screen job never needed it. Here the whole
              // point is confirming the truck without a QR, so the plate is
              // added alongside the reused row rather than forked into it.
              <div key={route.id} className="flex flex-col gap-1">
                <ReceptionMobileCompactRow
                  route={route}
                  waitingMinutes={null}
                  onOpen={() => setSelectedRouteId(route.id)}
                />
                <p className="px-1 font-mono text-xs text-text-secondary">
                  Patente: {route.plate ?? 'Sin patente'}
                </p>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
