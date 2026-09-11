'use client';

import { useState } from 'react';
import { Camera } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CameraIntake } from './CameraIntake';
import { cn } from '@/lib/utils';

/**
 * spec-82 phase 1 (mock 5c) — "Digitalizar manifiesto" on the mobile
 * active-route screen (`/app/pickup/route/active`). Reuses the exact OCR
 * intake flow already built for desktop's "Nuevo Manifiesto"
 * (CameraIntake / useCameraIntake, spec-47) — this is placement only, no
 * new capability, per the spec's own framing.
 *
 * A self-contained trigger (owns its own open/close state) rather than a
 * prop threaded down from `page.tsx`, deliberately: spec-82's phase-1 file
 * list names `app/app/pickup/route/active/page.tsx` but not
 * `PickupMobileView.tsx` or `app/app/pickup/page.tsx`, and desktop's
 * `intakeOpen` state lives on that different page entirely. Keeping the
 * dialog local here means this addition does not have to reach into files
 * outside the phase's declared scope.
 *
 * Mobile-3j (`PickupMobileStartRoute`) deliberately does NOT get this same
 * control — spec-54 already excluded "Nuevo Manifiesto" from that screen
 * on purpose ("that screen is for a driver starting a route", with a
 * regression test in app/app/pickup/page.test.tsx pinning it) and nothing
 * in spec-82's text revisits that call. Mock 5c is the active-ROUTE screen,
 * not the pre-route manifest list, so the two decisions do not conflict.
 *
 * spec-95 fase 2 — el mock mueve este botón del bloque inline que tenía
 * `page.tsx` a la fila fija del pie, junto a "Buscar", el toggle de
 * manifiestos y "+". Ahí necesita `flex-1`, no `w-full`. `className` sólo
 * reemplaza la parte de ANCHO del default (`w-full` ↔ `flex-1`, vía `??`,
 * nunca concatenados — dos utilidades de ancho distintas conviviendo
 * producirían un resultado indefinido). `min-h-[44px] gap-2` va por fuera,
 * con `cn`/twMerge, y se conserva SIEMPRE — L2, review: un `className` que
 * reemplazara el string entero (como antes) dejaba el botón sin su objetivo
 * táctil mínimo de 44px en cuanto alguien pasara un override sin pensar en
 * incluirlo.
 *
 * QA 2026-09-11 — a 390px la fila del pie (Buscar, Ver manifiesto(s),
 * Digitalizar, +) desbordaba: el label completo de este botón, en `flex-1`
 * junto al de "Ver manifiesto(s)" (también `flex-1`), no dejaba espacio
 * para "+" (quedaba 108px fuera de pantalla). `iconOnly` reduce el botón
 * al mismo target táctil fijo 44×44 que "Buscar" y "+" — mismo
 * comportamiento (abre el mismo diálogo OCR), sólo cambia la presentación:
 * sin texto visible, con `aria-label` como nombre accesible.
 */
export interface DigitalizeManifestTriggerProps {
  className?: string;
  /** Sin label visible; usa `aria-label` como nombre accesible y el mismo
   *  ancho fijo 44×44 que los otros botones-ícono de la fila. */
  iconOnly?: boolean;
}

export function DigitalizeManifestTrigger({
  className,
  iconOnly = false,
}: DigitalizeManifestTriggerProps = {}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // spec-82 fase 1 ronda 2 — un manifiesto digitalizado aquí queda sin
  // pickup_route_id, así que es candidato para el AddManifestSheet ("+").
  // useUnassignedManifests vive montado a nivel de página con staleTime de
  // 10s y no se remonta al abrir el sheet, así que sin invalidar aquí el
  // conductor no ve el manifiesto recién creado sin perder el contexto de
  // la ruta activa. Coincidencia parcial de queryKey a propósito: cubre
  // la entrada para cualquier operatorId sin necesitar leerlo aquí.
  const handleClose = () => {
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ['pickup', 'unassigned-manifests'] });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={iconOnly ? 'icon' : undefined}
        aria-label={iconOnly ? 'Digitalizar manifiesto' : undefined}
        className={cn(
          'min-h-[44px]',
          iconOnly ? 'min-w-[44px]' : 'gap-2',
          !iconOnly && (className ?? 'w-full'),
        )}
        onClick={() => setOpen(true)}
      >
        <Camera className="h-4 w-4" aria-hidden="true" />
        {!iconOnly && 'Digitalizar manifiesto'}
      </Button>

      {/* review round 2 — `onOpenChange={setOpen}` skipped `handleClose`
          (and its invalidation) for every dismissal that does not go
          through CameraIntake's own onClose: Esc, or Radix's built-in
          close X, both call onOpenChange(false) directly. Routing every
          closing transition through handleClose closes that gap; opening
          still goes through plain setOpen(true). */}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : handleClose())}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Digitalizar manifiesto</DialogTitle>
          </DialogHeader>
          <CameraIntake onClose={handleClose} />
        </DialogContent>
      </Dialog>
    </>
  );
}
