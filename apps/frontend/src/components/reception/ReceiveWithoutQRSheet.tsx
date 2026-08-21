'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ReceptionMobileCompactRow } from './ReceptionMobileCompactRow';
import { ReceiveWithoutQRButton } from './ReceiveWithoutQRButton';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

interface ReceiveWithoutQRSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: IncomingRoute[];
}

function plateLabel(plate: string | null) {
  return plate ?? 'Sin patente';
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
            <div className="flex flex-col gap-3">
              {/*
                Echo the armed route so the last screen before ending a
                driver's trip still says which truck it is — the button
                below no longer carries any route identity of its own.
                "Cambiar ruta" is the way back short of dismissing the
                whole sheet.
              */}
              <div className="flex items-center justify-between gap-3 rounded-[13px] border border-border bg-surface px-3.5 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-base font-bold text-text">
                    {selectedRoute.code}
                  </p>
                  <p className="mt-0.5 font-mono text-sm text-text-secondary">
                    Patente: {plateLabel(selectedRoute.plate)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 flex-none"
                  onClick={() => setSelectedRouteId(null)}
                >
                  Cambiar ruta
                </Button>
              </div>
              <ReceiveWithoutQRButton
                routeId={selectedRoute.id}
                code={selectedRoute.code}
                plate={selectedRoute.plate}
              />
            </div>
          ) : routes.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              Ninguna ruta en camino todavía.
            </p>
          ) : (
            routes.map((route) => (
              // `ReceptionMobileCompactRow` (Task 10) doesn't render the
              // plate — its yard-screen job never needed it, and it stays
              // untouched here. The plate is the single most load-bearing
              // datum on this screen (it's what gets matched against the
              // truck in front of the receptionist), so it's given its own
              // prominent line and a shared bordered container with the row
              // — never a dim caption floating between two cards, which
              // would be ambiguous about which row it belongs to.
              <div
                key={route.id}
                role="group"
                aria-label={`Ruta ${route.code}, patente ${plateLabel(route.plate)}`}
                data-testid={`receive-without-qr-option-${route.id}`}
                className="flex flex-col gap-1 rounded-[13px] border border-border bg-surface p-1"
              >
                <p className="px-2.5 pt-1.5 font-mono text-sm font-semibold text-text">
                  Patente: {plateLabel(route.plate)}
                </p>
                <ReceptionMobileCompactRow
                  route={route}
                  waitingMinutes={null}
                  onOpen={() => setSelectedRouteId(route.id)}
                />
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
